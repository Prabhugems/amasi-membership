import { createAdminClient } from "@/lib/supabase"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { verifyEditToken, touchEditToken } from "@/lib/mou/edit-token"
import type { AcademicEventApplication } from "@/lib/mou/types"

const OTP_WINDOW_MS = 2 * 60 * 60 * 1000 // 2h — matches src/app/api/applications/resubmit/route.ts's window

export type ApplicantCredentialResult =
  | { ok: true; via: "edit_token" | "otp"; application: AcademicEventApplication }
  | { ok: false; status: number; message: string }

// Shared by every applicant-facing write on an existing application (the
// edit route, the change-request route): resolves EITHER a bearer edit
// token OR an OTP-verified-within-window email into proof that the caller
// owns this specific application, and always cross-checks the resolved
// credential against `applicationId` — never trusts it on its own. A token
// minted for application A must never authorize acting on application B
// just because the caller changed the URL; a verified OTP for the
// caller's own email must never unlock a stranger's application either
// (see the email-must-match-application.email check below, checked BEFORE
// querying otp_codes, so a caller can't even fish for whether an OTP
// exists for someone else's email).
export async function resolveApplicantCredential(
  applicationId: string,
  credential: { editToken?: string; email?: string }
): Promise<ApplicantCredentialResult> {
  const application = await getApplicationById(applicationId)
  if (!application) return { ok: false, status: 404, message: "Application not found." }

  if (credential.editToken) {
    const result = await verifyEditToken(credential.editToken)
    if (!result.ok) return { ok: false, status: 403, message: result.message }
    if (result.row.application_id !== applicationId) {
      // Deliberately the same generic message as a plain invalid token —
      // never confirm to the caller that the token was valid for a
      // *different* application.
      return { ok: false, status: 403, message: "This link is not valid." }
    }
    await touchEditToken(credential.editToken)
    return { ok: true, via: "edit_token", application }
  }

  if (credential.email) {
    // Both the "wrong email" and "right email but no verified OTP yet"
    // cases return the exact same status + message. A caller who already
    // knows a valid application UUID (the id itself is public — it's the
    // read-side capability for GET /api/mou/applications/[id]) must not be
    // able to distinguish the two by response shape: that would let them
    // enumerate, one guess at a time, whether a given email is the real
    // applicant's email for this application — a genuine, if minor,
    // information-disclosure oracle. The email-mismatch check still runs
    // first so a wrong guess never even queries otp_codes, but the
    // response given back is identical either way.
    const genericAuthRequired = { ok: false as const, status: 401, message: "Please verify your email via OTP first." }
    if (credential.email.toLowerCase() !== application.email.toLowerCase()) {
      return genericAuthRequired
    }
    const supabase = createAdminClient()
    const windowStart = new Date(Date.now() - OTP_WINDOW_MS).toISOString()
    const { data: otpCheck } = await supabase
      .from("otp_codes")
      .select("id")
      .eq("email", application.email.toLowerCase())
      .eq("verified", true)
      .gte("created_at", windowStart)
      .limit(1)
      .maybeSingle()
    if (!otpCheck) {
      return genericAuthRequired
    }
    return { ok: true, via: "otp", application }
  }

  return { ok: false, status: 401, message: "Authentication required." }
}
