import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { signToken, verifyToken, setMemberCookie, claimJtiOnce } from "@/lib/auth"

/**
 * One-click resume from an emailed link. The token is a short-lived JWT
 * (role="member", source="resume_link", draftId, email) we sign when the
 * admin sends a reminder. Possession of the email inbox is proof of email
 * ownership, so verifying the token is enough — no OTP required.
 *
 * On success we set the same amasi_member_token cookie the OTP flow uses,
 * so /api/applications/save-draft (which calls getMemberSession()) accepts
 * subsequent writes from this browser for ~1h.
 */
export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`resume-token:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
  }

  const { token } = await request.json().catch(() => ({ token: "" })) as { token?: string }
  if (!token || typeof token !== "string") {
    return Response.json({ status: false, message: "Missing token" }, { status: 400 })
  }

  const payload = await verifyToken(token)
  if (!payload || payload.role !== "member" || payload.source !== "resume_link") {
    return Response.json({ status: false, message: "Link is invalid or has expired" }, { status: 401 })
  }

  const email = (payload.email as string || "").toLowerCase().trim()
  const draftId = payload.draftId as string | undefined
  const jti = typeof payload.jti === "string" ? payload.jti : null
  if (!email || !draftId) {
    return Response.json({ status: false, message: "Link is malformed" }, { status: 400 })
  }

  // Single-use enforcement. Older resume tokens minted before this fix have
  // no jti — let those through (they will age out in ≤14d). Tokens with a
  // jti must claim it atomically; a duplicate click is treated as a replay.
  if (jti) {
    const claimed = await claimJtiOnce(jti)
    if (!claimed) {
      return Response.json({ status: false, message: "Link is invalid or has expired" }, { status: 401 })
    }
  }

  const supabase = createAdminClient()
  const { data: draft, error } = await supabase
    .from("draft_applications")
    .select("id, email, status, current_step, step_data, membership_type, payment_order_id, payment_id, updated_at")
    .eq("id", draftId)
    .maybeSingle()

  if (error || !draft) {
    return Response.json({ status: false, message: "Draft not found" }, { status: 404 })
  }
  if (draft.email.toLowerCase() !== email) {
    return Response.json({ status: false, message: "Link does not match this draft" }, { status: 403 })
  }

  // Issue the standard member session cookie (24h, matches the OTP-verify
  // path) so save-draft and /api/ocr accept writes for the duration of the
  // applicant's session. verifyMemberSession() in save-draft only checks
  // role=member + email match. See AMASI-MEMBERSHIP-31.
  const sessionToken = await signToken({ role: "member", email }, "24h")
  await setMemberCookie(sessionToken)

  // If draft was parked (stuck/payment_on_hold), flip back to in_progress so
  // the applicant can actually continue — identical to the admin Resume button.
  if (draft.status !== "in_progress") {
    await supabase
      .from("draft_applications")
      .update({ status: "in_progress", failure_reason: null, stale_since: null, updated_at: new Date().toISOString() })
      .eq("id", draft.id)
  }

  return Response.json({
    status: true,
    draft: {
      id: draft.id,
      email: draft.email,
      current_step: draft.current_step,
      membership_type: draft.membership_type,
      step_data: draft.step_data || {},
      payment_order_id: draft.payment_order_id,
      payment_id: draft.payment_id,
      updated_at: draft.updated_at,
    },
  })
}

