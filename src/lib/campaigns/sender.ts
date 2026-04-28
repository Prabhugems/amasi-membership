import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { getTemplate } from "./registry"
import { createPacer } from "./rate-limiter"
import { logMembershipAuditEvent } from "@/lib/audit-log"
import { signAutoLoginToken } from "@/lib/auth"
import type { CampaignRecipientRow, CampaignRow, MemberSegmentRow } from "./types"

// Lazy: instantiating at module top-level throws "Missing API key" during
// Next.js's "Collecting page data" build phase when RESEND_API_KEY is absent
// (e.g. CI builds without server secrets). Defer until first use.
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY
    if (!key) throw new Error("RESEND_API_KEY is not configured")
    _resend = new Resend(key)
  }
  return _resend
}
const fromEmail = process.env.RESEND_FROM_EMAIL || "AMASI <noreply@amasi.org>"
const baseUrl = "https://membership.amasi.org"

const DEFAULT_GAP_MS = 500 // 2 req/s, matches Resend free tier

export interface SendBatchResult {
  sent: number
  failed: number
  remaining: number
}

export async function sendNextBatch(params: {
  campaignId: string
  limit?: number
  supabase?: SupabaseClient
}): Promise<SendBatchResult> {
  const db = params.supabase ?? createAdminClient()
  const limit = params.limit ?? 100

  const { data: campaign, error: campErr } = await db
    .from("email_campaigns")
    .select("*")
    .eq("id", params.campaignId)
    .single<CampaignRow>()
  if (campErr || !campaign) {
    throw new Error(`campaign not found: ${params.campaignId}`)
  }
  if (campaign.status !== "sending") {
    return { sent: 0, failed: 0, remaining: 0 }
  }

  const template = getTemplate(campaign.template_key)

  const { data: recipients, error: recErr } = await db
    .from("email_campaign_recipients")
    .select("*")
    .eq("campaign_id", params.campaignId)
    .is("sent_at", null)
    .order("id", { ascending: true })
    .limit(limit)
    .returns<CampaignRecipientRow[]>()
  if (recErr) throw new Error(`recipient fetch failed: ${recErr.message}`)

  if (!recipients || recipients.length === 0) {
    await db.from("email_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
    return { sent: 0, failed: 0, remaining: 0 }
  }

  const pacer = createPacer(DEFAULT_GAP_MS)
  let sent = 0
  let failed = 0

  for (const r of recipients) {
    await pacer.wait()
    const member: MemberSegmentRow = {
      id: r.member_id,
      amasi_number: r.amasi_number ?? 0,
      name: r.name,
      email: r.email,
      pg_degree: null, profile_photo: null, date_of_birth: null,
      membership_type: null, marketing_opt_out_at: null,
    }
    try {
      // Mint a single-use 24h auto-login token per recipient so the email's
      // CTA can drop them straight onto /member?tab=documents — no OTP, no
      // wandering off into /apply. JWT_SECRET is required for sign(); if it
      // isn't configured we still send the email but the link falls back to
      // plain /m (which itself redirects to /member, prompting OTP).
      let autoLoginToken: string | undefined
      try {
        autoLoginToken = await signAutoLoginToken({
          memberId: r.member_id,
          email: r.email,
          amasiNumber: r.amasi_number ?? 0,
        })
      } catch (e) {
        console.error("[campaigns] failed to mint auto-login token", { recipientId: r.id, error: e instanceof Error ? e.message : String(e) })
      }
      await getResend().emails.send({
        from: fromEmail,
        to: r.email,
        subject: template.subject(member),
        html: template.html(member, { baseUrl, autoLoginToken }),
      })
      await db.from("email_campaign_recipients")
        .update({ sent_at: new Date().toISOString(), send_error: null })
        .eq("id", r.id)
      sent++
    } catch (e) {
      const msg = e instanceof Error ? e.message : "send failed"
      await db.from("email_campaign_recipients")
        .update({ send_error: msg })
        .eq("id", r.id)
      failed++
    }
  }

  // Remaining count — cheap count query.
  const { count: remaining } = await db
    .from("email_campaign_recipients")
    .select("*", { count: "exact", head: true })
    .eq("campaign_id", campaign.id)
    .is("sent_at", null)

  // Audit trail (non-authoritative; source of truth is email_campaigns tables).
  await logMembershipAuditEvent({
    action: "campaign_batch_sent",
    entityType: "campaign",
    entityId: campaign.id,
    newData: { sent, failed, remaining: remaining ?? 0, template_key: campaign.template_key },
    performedBy: "sender",
  }, db)

  if ((remaining ?? 0) === 0) {
    await db.from("email_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
  }

  return { sent, failed, remaining: remaining ?? 0 }
}
