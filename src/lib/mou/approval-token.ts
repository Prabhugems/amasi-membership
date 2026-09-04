import crypto from "crypto"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export interface ApprovalTokenRow {
  id: string
  application_id: string
  role: string
  can_decide: boolean
}

export async function createApprovalToken(
  applicationId: string,
  role: string,
  canDecide: boolean,
  expiresInDays = 30
): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex")
  const supabase = createAdminClient()
  const { error } = await supabase.from("academic_event_approval_tokens").insert({
    application_id: applicationId,
    token_hash: hashToken(raw),
    role,
    can_decide: canDecide,
    expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (error) {
    Sentry.captureException(error, {
      tags: { component: "mou-approval-token", op: "create" },
      extra: { applicationId, role, canDecide },
    })
    // A caller holding a raw token string it can't trust (because the row
    // backing it may not exist) is worse than an explicit failure here — the
    // one thing this whole workflow depends on is a working magic link, so
    // don't hand back a token that will only ever surface as a confusing
    // "This link is not valid" click-through later. Callers (see
    // src/app/api/mou/applications/route.ts) must catch this.
    throw new Error(`Failed to create approval token: ${error.message}`)
  }
  return raw
}

type VerifyResult = { ok: true; row: ApprovalTokenRow } | { ok: false; message: string }

export async function verifyApprovalToken(rawToken: string): Promise<VerifyResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("academic_event_approval_tokens")
    .select("id, application_id, role, can_decide, expires_at, used_at")
    .eq("token_hash", hashToken(rawToken))
    .single()

  if (error || !data) return { ok: false, message: "This link is not valid." }
  if (new Date(data.expires_at) < new Date()) return { ok: false, message: "This link has expired." }
  if (data.used_at) return { ok: false, message: "This link has already been used to make a decision." }

  return { ok: true, row: data }
}

export async function markTokenUsed(
  rawToken: string,
  action: "approved" | "rejected" | "changes_requested"
): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("academic_event_approval_tokens")
    .update({ action_taken: action, used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(rawToken))
  if (error) {
    // Don't throw: by the time this runs (see decide/route.ts) the decision
    // is already persisted, and cascading a token-burn failure into a 500
    // would tell the Hon. Secretary their decision failed when it didn't.
    // Capture so a token that silently failed to burn is still detectable.
    Sentry.captureException(error, {
      tags: { component: "mou-approval-token", op: "mark-used" },
      extra: { action },
    })
  }
}
