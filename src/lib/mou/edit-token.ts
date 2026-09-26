import crypto from "crypto"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export interface EditTokenRow {
  id: string
  application_id: string
}

// Deliberately a separate table/module from approval-token.ts: this token
// is multi-use (an applicant edits the same application repeatedly while
// submitted, then again after changes_requested) and revoked explicitly
// via `revoked_at`, not burned-on-use via `used_at` — a shape that doesn't
// fit academic_event_approval_tokens' single-use decision-token semantics,
// which three other routes (decide/route.ts, applications/route.ts,
// mou-report-reminders.ts) already depend on unconditionally.
export async function createEditToken(applicationId: string, expiresInDays = 180): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex")
  const supabase = createAdminClient()
  const { error } = await supabase.from("academic_event_edit_tokens").insert({
    application_id: applicationId,
    token_hash: hashToken(raw),
    expires_at: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (error) {
    Sentry.captureException(error, {
      tags: { component: "mou-edit-token", op: "create" },
      extra: { applicationId },
    })
    // Same reasoning as createApprovalToken: don't hand back a raw token
    // string that isn't actually backed by a row — it will only ever
    // surface later as a confusing "This link is not valid" click-through.
    throw new Error(`Failed to create edit token: ${error.message}`)
  }
  return raw
}

type VerifyResult = { ok: true; row: EditTokenRow } | { ok: false; message: string }

export async function verifyEditToken(rawToken: string): Promise<VerifyResult> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("academic_event_edit_tokens")
    .select("id, application_id, expires_at, revoked_at")
    .eq("token_hash", hashToken(rawToken))
    .single()

  if (error || !data) return { ok: false, message: "This link is not valid." }
  if (data.revoked_at) return { ok: false, message: "This link has been revoked." }
  if (new Date(data.expires_at) < new Date()) return { ok: false, message: "This link has expired." }

  // No used_at check — this token is intentionally multi-use. Callers
  // (see src/lib/mou/applicant-auth.ts) must still cross-check
  // row.application_id against the application id being acted on; this
  // function only proves the token itself is live, not which application
  // the caller is trying to act on.
  return { ok: true, row: { id: data.id, application_id: data.application_id } }
}

export async function touchEditToken(rawToken: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("academic_event_edit_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(rawToken))
  if (error) {
    // Best-effort only — a failed last_used_at write must never block the
    // edit it's just bookkeeping for. Capture so it's still detectable.
    Sentry.captureException(error, {
      tags: { component: "mou-edit-token", op: "touch" },
    })
  }
}

// Admin-triggered (e.g. applicant reports the link as compromised).
// Revokes every live token for the application rather than requiring the
// caller to know which specific token row to target.
export async function revokeEditToken(applicationId: string): Promise<void> {
  const supabase = createAdminClient()
  const { error } = await supabase
    .from("academic_event_edit_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("application_id", applicationId)
    .is("revoked_at", null)
  if (error) {
    Sentry.captureException(error, {
      tags: { component: "mou-edit-token", op: "revoke" },
      extra: { applicationId },
    })
    throw new Error(`Failed to revoke edit token: ${error.message}`)
  }
}
