import { Resend } from "resend"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import {
  certEmailSubject,
  certPageUrl,
  buildCertEmailHtml,
  type EmailableCredentialType,
} from "@/lib/fmas-cert-email"

// Stay well under Resend's default rate limit; also keeps a single batch
// invocation comfortably inside one serverless function's execution window.
const SEND_DELAY_MS = 150
export const DEFAULT_BATCH_SIZE = 300

interface Recipient {
  amasi_number: number
  name: string | null
  email: string
}

export interface BulkSendBatchResult {
  sent: number
  failed: number
  failedDetails: { amasi_number: number; email: string; reason: string }[]
  remaining: number
  totalEligible: number
}

// Credential emails already sent for this (type, year) live in
// admin_audit_log (the same table the single-send "Email cert" admin action
// writes to) — re-used here as the dedup source instead of a new DB column,
// so a bulk send is safely resumable across multiple batch calls.
async function fetchAlreadyEmailed(
  db: SupabaseClient,
  credentialType: EmailableCredentialType,
  year: number
): Promise<Set<number>> {
  const sent = new Set<number>()
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from("admin_audit_log")
      .select("entity_id")
      .eq("action", "credential_email_sent")
      .eq("entity_type", "member_credential")
      .contains("details", { credential_type: credentialType, year })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      if (row.entity_id) sent.add(Number(row.entity_id))
    }
    if (data.length < PAGE) break
    from += PAGE
  }
  return sent
}

async function fetchCredentialAmasiNumbers(
  db: SupabaseClient,
  credentialType: EmailableCredentialType,
  year: number
): Promise<number[]> {
  const all: number[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from("member_credentials")
      .select("amasi_number")
      .eq("credential_type", credentialType)
      .eq("year", year)
      .order("amasi_number", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...data.map((r) => r.amasi_number as number))
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function fetchEligibleRecipients(
  db: SupabaseClient,
  credentialType: EmailableCredentialType,
  year: number,
  alreadySent: Set<number>
): Promise<Recipient[]> {
  const amasiNumbers = (await fetchCredentialAmasiNumbers(db, credentialType, year)).filter(
    (a) => !alreadySent.has(a)
  )
  if (amasiNumbers.length === 0) return []

  const byAmasi = new Map<number, Recipient>()
  const CHUNK = 500
  for (let i = 0; i < amasiNumbers.length; i += CHUNK) {
    const chunk = amasiNumbers.slice(i, i + CHUNK)
    const { data, error } = await db
      .from("members")
      .select("amasi_number, name, email")
      .in("amasi_number", chunk)
    if (error) throw error
    for (const m of data ?? []) {
      if (m.email) {
        byAmasi.set(m.amasi_number, { amasi_number: m.amasi_number, name: m.name, email: m.email })
      }
    }
  }

  return amasiNumbers.map((a) => byAmasi.get(a)).filter((r): r is Recipient => r !== undefined)
}

export async function countEligibleFmasCertEmails(
  credentialType: EmailableCredentialType,
  year: number
): Promise<number> {
  const db = createAdminClient()
  const alreadySent = await fetchAlreadyEmailed(db, credentialType, year)
  const eligible = await fetchEligibleRecipients(db, credentialType, year, alreadySent)
  return eligible.length
}

// Best-effort guard against two overlapping bulk sends for the same
// (type, year) — double-click, two admin tabs — double-emailing recipients
// before either write completes; see fetchAlreadyEmailed(), which only
// excludes rows already committed, not ones mid-flight in a concurrent
// call. This is in-memory and per-instance, so it does NOT protect against
// two concurrent requests landing on different serverless instances; it
// closes the common same-browser-process race, not every race.
const sendingKeys = new Set<string>()

/**
 * Send the next batch of certificate emails for (credentialType, year) to
 * whichever eligible recipients haven't been emailed yet. Safe to call
 * repeatedly — each call re-derives the eligible set from admin_audit_log,
 * so a caller (e.g. the admin UI) can loop this until `remaining` is 0, and
 * an interrupted run picks up cleanly where it left off.
 */
export async function sendNextFmasCertEmailBatch(
  actorEmail: string,
  opts: { credentialType?: EmailableCredentialType; year: number; batchSize?: number }
): Promise<BulkSendBatchResult> {
  const credentialType = opts.credentialType ?? "FMAS"
  const key = `${credentialType}:${opts.year}`
  if (sendingKeys.has(key)) {
    throw new Error(
      `A bulk send for ${credentialType} ${opts.year} is already in progress — wait for it to finish before starting another.`
    )
  }
  sendingKeys.add(key)
  try {
    return await sendNextFmasCertEmailBatchInner(actorEmail, credentialType, opts)
  } finally {
    sendingKeys.delete(key)
  }
}

async function sendNextFmasCertEmailBatchInner(
  actorEmail: string,
  credentialType: EmailableCredentialType,
  opts: { year: number; batchSize?: number }
): Promise<BulkSendBatchResult> {
  const db = createAdminClient()
  const batchSize =
    opts.batchSize && opts.batchSize > 0 ? Math.min(opts.batchSize, 500) : DEFAULT_BATCH_SIZE

  const alreadySent = await fetchAlreadyEmailed(db, credentialType, opts.year)
  const eligible = await fetchEligibleRecipients(db, credentialType, opts.year, alreadySent)
  const batch = eligible.slice(0, batchSize)

  const resendKey = process.env.RESEND_API_KEY?.trim()
  if (!resendKey) throw new Error("RESEND_API_KEY not configured")
  const resend = new Resend(resendKey)
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"

  let sent = 0
  const failedDetails: { amasi_number: number; email: string; reason: string }[] = []

  for (const r of batch) {
    const certUrl = certPageUrl(credentialType, r.amasi_number)
    try {
      await resend.emails.send({
        from,
        to: r.email,
        subject: certEmailSubject(credentialType),
        html: buildCertEmailHtml({ credentialType, name: r.name ?? "Doctor", certUrl }),
      })
      sent++
      await logAdminAction({
        adminEmail: actorEmail,
        action: "credential_email_sent",
        entityType: "member_credential",
        entityId: String(r.amasi_number),
        details: { credential_type: credentialType, year: opts.year, to: r.email, bulk: true },
      })
    } catch (err) {
      console.error(`[bulk-fmas-cert-email] send to ${r.email}:`, err)
      failedDetails.push({
        amasi_number: r.amasi_number,
        email: r.email,
        reason: err instanceof Error ? err.message : "send failed",
      })
    }
    if (SEND_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, SEND_DELAY_MS))
    }
  }

  return {
    sent,
    failed: failedDetails.length,
    failedDetails,
    remaining: Math.max(0, eligible.length - batch.length),
    totalEligible: eligible.length,
  }
}
