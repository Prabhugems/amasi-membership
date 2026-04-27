import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase"
import { signToken, setMemberCookie } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { generateRefNumber } from "@/lib/reference-number"
import { recordStepEvent } from "@/lib/funnel-tracking"
import { escapeHtml } from "@/lib/html-escape"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    // Rate limit: 10 verify attempts per 15 minutes per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`otp-verify:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
    }

    const { email, code } = await request.json()

    if (!email || !code) {
      return Response.json({ status: false, message: "Email and code are required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Find the latest unexpired, unverified OTP for this email
    const { data: otpRecord, error } = await supabase
      .from("otp_codes")
      .select("*")
      .eq("email", email.toLowerCase())
      .eq("verified", false)
      .gte("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error || !otpRecord) {
      return Response.json({ status: false, message: "No valid OTP found. Please request a new one." }, { status: 400 })
    }

    // Check max attempts (5)
    if (otpRecord.attempts >= 5) {
      return Response.json({ status: false, message: "Too many incorrect attempts. Please request a new OTP." }, { status: 429 })
    }

    // Increment attempts
    await supabase
      .from("otp_codes")
      .update({ attempts: otpRecord.attempts + 1 })
      .eq("id", otpRecord.id)

    // Verify code
    if (otpRecord.code !== code.trim()) {
      const remaining = 5 - (otpRecord.attempts + 1)
      return Response.json({
        status: false,
        message: `Incorrect code. ${remaining} attempt${remaining !== 1 ? "s" : ""} remaining.`,
      }, { status: 400 })
    }

    // Mark as verified
    await supabase
      .from("otp_codes")
      .update({ verified: true })
      .eq("id", otpRecord.id)

    // Create member JWT session cookie
    const token = await signToken({
      sub: otpRecord.id,
      email: otpRecord.email,
      role: "member",
    }, "1h")
    await setMemberCookie(token)

    const normalizedEmail = email.toLowerCase().trim()

    // ── Draft + reference_number assignment ────────────────────────────────
    // Three cases for an existing non-terminal draft:
    //   1. Draft exists with reference_number → idempotent: reuse it.
    //   2. Draft exists without reference_number (pre-migration) → backfill.
    //   3. No draft, new applicant (not an existing member) → INSERT new row.
    //
    // Guard for case 3: only create a draft for new applicants, not for member
    // login / profile-update / resubmit flows. Without this guard, any member
    // OTP login would spawn a null-type zombie draft — the same class of bug
    // fixed in the send route by 247444d.

    let draftId: string | null = null
    let referenceNumber: string | null = null
    let isNewDraft = false
    let resolvedDraftRow: {
      id: string
      current_step: number
      membership_type: string | null
      status: string
      has_verified_payment: boolean | null
      created_at: string
      updated_at: string
      reference_number: string | null
    } | null = null

    try {
      const { data: existing } = await supabase
        .from("draft_applications")
        .select("id, current_step, membership_type, status, has_verified_payment, created_at, updated_at, reference_number, step_data")
        .eq("email", normalizedEmail)
        .not("status", "in", "(completed,expired,refunded)")
        .limit(1)
        .maybeSingle()

      if (existing) {
        draftId = existing.id
        // Assign/backfill reference_number before the combined UPDATE below
        referenceNumber = existing.reference_number ?? generateRefNumber()

        // Sync email_verified server-side so this doesn't depend on the
        // client save-draft round-trip in apply/page.tsx, which races the
        // Set-Cookie commit and is fire-and-forget. Without this, 27 drafts
        // in the last 30d had otp_codes.verified=true but step_data still
        // showed only {otp_sent, otp_sent_at} — the client call was lost.
        const mergedStepData = {
          ...(existing.step_data || {}),
          email_verified: true,
          email_verified_at: new Date().toISOString(),
        }
        const { data: updated, error: syncError } = await supabase
          .from("draft_applications")
          .update({
            step_data: mergedStepData,
            reference_number: referenceNumber,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select("id, current_step, membership_type, status, has_verified_payment, created_at, updated_at, reference_number")
          .single()

        if (syncError) {
          Sentry.captureException(syncError, {
            tags: { component: "otp-verify", op: "draft-email-verified-sync" },
            extra: { draftId: existing.id },
          })
        }

        resolvedDraftRow = updated ?? existing
      } else {
        // No existing draft — only create one for new applicants.
        // Skip if this email belongs to an existing member (login / resubmit
        // / profile-update OTP). The send route applies the same guard so
        // we mirror it here to avoid zombie drafts.
        const { data: existingMember } = await supabase
          .from("members")
          .select("id")
          .ilike("email", normalizedEmail)
          .limit(1)
          .maybeSingle()

        if (!existingMember) {
          referenceNumber = generateRefNumber()
          const { data: newDraft } = await supabase
            .from("draft_applications")
            .insert({
              email: normalizedEmail,
              reference_number: referenceNumber,
              current_step: 1,
              status: "in_progress",
            })
            .select("id")
            .single()
            .throwOnError()
          draftId = newDraft?.id ?? null
          isNewDraft = true
        }
      }
    } catch (err) {
      Sentry.captureException(err, {
        tags: { component: "otp-verify", op: "draft-lookup" },
      })
      // Draft operation failure is non-blocking — OTP is still verified
    }

    // ── Welcome email (new applicants only — idempotent: skip on re-verify) ──
    if (isNewDraft && referenceNumber) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://application.amasi.org"
      const trackUrl = `${baseUrl}/track?ref=${encodeURIComponent(referenceNumber)}`
      try {
        const resend = getResend()
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: normalizedEmail,
          subject: "Welcome to AMASI — your application has started",
          html: `
            <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
              <div style="background:linear-gradient(135deg,#0d9488,#14b8a6);border-radius:12px 12px 0 0;padding:20px 24px;">
                <h2 style="color:#fff;margin:0;font-size:18px;">AMASI Membership Application Started</h2>
              </div>
              <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
                <p style="color:#374151;font-size:15px;">Your email has been verified and your application is now in progress.</p>
                <div style="background:#f0fdfa;border:1px solid #99f6e4;border-radius:8px;padding:16px;margin:20px 0;">
                  <p style="color:#0f766e;font-size:13px;margin:0 0 4px;font-weight:600;">Your reference number</p>
                  <p style="color:#134e4a;font-size:20px;font-weight:700;font-family:monospace;margin:0;">${escapeHtml(referenceNumber)}</p>
                </div>
                <p style="color:#6b7280;font-size:14px;">Keep this reference number safe — you can use it to track your application at any time.</p>
                <div style="text-align:center;margin:24px 0;">
                  <a href="${trackUrl}" style="display:inline-block;background:#0d9488;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Track your application</a>
                </div>
                <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:16px;">Association of Minimal Access Surgeons of India</p>
              </div>
            </div>
          `,
        })
      } catch (emailErr) {
        // Email failure is non-fatal — the draft is already created
        console.error("[otp-verify] welcome email failed:", emailErr)
        Sentry.captureException(emailErr, { tags: { flow: "otp_verify_welcome_email" } })
      }
    }

    // ── Funnel event: stage_1_complete ──────────────────────────────────────
    if (referenceNumber) {
      void recordStepEvent({
        email: normalizedEmail,
        draftId,
        eventType: "stage_1_complete",
        step: 1,
        status: "email_verified",
        metadata: { reference_number: referenceNumber, is_new_draft: isNewDraft },
      }, supabase)
    }

    // ── Build draft summary for client ──────────────────────────────────────
    // Only return metadata — step_data contains PII and is fetched
    // separately via GET /api/applications/save-draft after user clicks Resume
    let draft = null
    if (resolvedDraftRow) {
      draft = {
        id: resolvedDraftRow.id,
        current_step: resolvedDraftRow.current_step,
        membership_type: resolvedDraftRow.membership_type,
        status: resolvedDraftRow.status,
        has_verified_payment: resolvedDraftRow.has_verified_payment,
        created_at: resolvedDraftRow.created_at,
        updated_at: resolvedDraftRow.updated_at,
        reference_number: referenceNumber,
      }
    }

    return Response.json({
      status: true,
      message: "Email verified successfully",
      hasDraft: !!resolvedDraftRow,
      draft,
      reference_number: referenceNumber,
    })
  } catch (error: unknown) {
    console.error("OTP verify error:", error)
    Sentry.captureException(error, { tags: { component: "otp-verify" } })
    return Response.json({ status: false, message: "Verification failed" }, { status: 500 })
  }
}
