// @auth: public — applicant submits before any account exists; the OTP-verified
// email + reference number in the body are the integrity check.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { Resend } from "resend"
import { scoreApplication } from "@/lib/ai-approval"
import { recordStepEvent } from "@/lib/funnel-tracking"
import { sendApplicationSubmittedWhatsApp } from "@/lib/whatsapp"
import { autoApproveApplication } from "@/lib/auto-approval"
import { logAiDecision, updateAiDecisionOutcome, type AiDecisionInput } from "@/lib/ai-decision-log"
import {
  validateRequiredDocuments,
  lookupDocumentLabel,
  formatManualReviewReason,
  type ManualReviewReasonCode,
} from "@/lib/document-keys"
import { getMembershipType } from "@/lib/membership-types"
import { escapeHtml } from "@/lib/html-escape"
import { buildApplicationRow } from "@/lib/build-application-row"

// AI scoring + auto-approval + admin email + WhatsApp + Zoho in one request.
export const maxDuration = 60

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

async function notifyAdminsNewApplication(details: {
  applicantName: string
  email: string
  membershipType: string
  referenceNumber: string
  applicationId: string
  aiConfidence: string
  needsManualReview: boolean
}) {
  const supabase = createAdminClient()
  const { data: admins } = await supabase
    .from("admin_users")
    .select("email")
    .eq("is_active", true)

  const adminEmails = (admins || []).map((a) => a.email).filter(Boolean) as string[]
  const envAdminEmail = (process.env.ADMIN_DEFAULT_EMAIL || "admin@amasi.org").trim().toLowerCase()
  if (!adminEmails.includes(envAdminEmail)) adminEmails.push(envAdminEmail)

  if (adminEmails.length === 0) return

  const resend = getResend()
  const statusBadge = details.needsManualReview
    ? '<span style="background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600;">Needs Manual Review</span>'
    : '<span style="background:#d1fae5;color:#065f46;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600;">AI Approved</span>'

  // Always use the Razorpay-registered branded domain for customer-facing URLs.
  // A .vercel.app fallback causes Razorpay to block payments with
  // "website does not match registered website(s)".
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://membership.amasi.org"

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:linear-gradient(135deg,#0d9488,#14b8a6);border-radius:12px 12px 0 0;padding:20px 24px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">New Membership Application</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
          <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Applicant</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.applicantName)}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Email</td><td style="padding:8px 0;">${escapeHtml(details.email)}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Membership Type</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(details.membershipType)}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Reference</td><td style="padding:8px 0;font-family:monospace;">${escapeHtml(details.referenceNumber)}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">AI Confidence</td><td style="padding:8px 0;">${escapeHtml(details.aiConfidence)}</td></tr>
          <tr><td style="padding:8px 0;color:#6b7280;">Status</td><td style="padding:8px 0;">${statusBadge}</td></tr>
        </table>
        <div style="margin-top:20px;text-align:center;">
          <a href="${baseUrl}/pending" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review Application</a>
        </div>
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:16px;">AMASI Membership Management</p>
      </div>
    </div>
  `

  await Promise.allSettled(
    adminEmails.map((email) =>
      resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: email,
        subject: `New Application: ${details.applicantName} (${details.membershipType})`,
        html,
      })
    )
  )
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      formData,
      referenceNumber,
      paymentId,
      uploads, // { docType: { status, extracted, message } }
    } = body

    if (!formData || !referenceNumber) {
      return Response.json({ status: false, message: "Missing data" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // --- Auth gate 1: verify payment exists & is paid (server-recorded via webhook/verify) ---
    if (!paymentId) {
      return Response.json({ status: false, message: "Payment not verified" }, { status: 401 })
    }

    const { data: paymentRow } = await supabase
      .from("membership_payments")
      .select("id, status")
      .eq("gateway_payment_id", paymentId)
      .eq("status", "paid")
      .limit(1)
      .maybeSingle()

    if (!paymentRow) {
      return Response.json({ status: false, message: "Payment not verified" }, { status: 401 })
    }

    // --- Auth gate 2: verify OTP completion (email and/or mobile) within last 60 min ---
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString()
    const emailKey = (formData.email || "").toLowerCase()
    const mobileKey = formData.mobile ? `sms:${formData.mobile}` : null

    let emailVerified = false
    let mobileVerified = false

    if (emailKey) {
      const { data: emailOtp } = await supabase
        .from("otp_codes")
        .select("id")
        .eq("email", emailKey)
        .eq("verified", true)
        .gte("created_at", twoHoursAgo)
        .limit(1)
        .maybeSingle()
      emailVerified = !!emailOtp
    }

    if (mobileKey) {
      const { data: mobileOtp } = await supabase
        .from("otp_codes")
        .select("id")
        .eq("email", mobileKey)
        .eq("verified", true)
        .gte("created_at", twoHoursAgo)
        .limit(1)
        .maybeSingle()
      mobileVerified = !!mobileOtp
    }

    if (!emailVerified && !mobileVerified) {
      return Response.json({ status: false, message: "Email/mobile not verified" }, { status: 401 })
    }

    // --- Auth gate 3: verify required documents are present, uploaded, and OCR-extracted ---
    // PR 0: validateRequiredDocuments now also accepts docs that came through
    // the manual-review bypass path (status='uploaded' + bypass=true + fileUrl).
    // Bypass docs surface in `bypassedDocs`; the application MUST be flagged
    // for manual review and skip auto-approve. See document-keys.ts for the
    // canonical rule and the list of three call sites.
    let bypassedDocsFromValidator: { key: string; reason: ManualReviewReasonCode }[] = []
    const membershipType = getMembershipType(formData.membershipType)
    if (membershipType) {
      const docValidation = validateRequiredDocuments(uploads || {}, membershipType.requiredDocs)
      if (!docValidation.valid) {
        const missingLabels = docValidation.missing.map(lookupDocumentLabel)
        // Log to ai_decisions for tracking
        try {
          await logAiDecision(supabase, {
            applicationId: "rejected-pre-scoring",
            applicationReference: referenceNumber,
            membershipType: formData.membershipType,
            formData,
            uploads: uploads || {},
            paymentPaid: true,
          }, null, 0, { message: `${docValidation.reason}: ${docValidation.missing.join(", ")}` })
        } catch {}
        return Response.json({
          status: false,
          reason: docValidation.reason,
          missingDocuments: docValidation.missing,
          message: `These documents need a clearer upload before we can submit your application: ${missingLabels.join(", ")}.`,
        }, { status: 400 })
      }
      bypassedDocsFromValidator = docValidation.bypassedDocs
    }

    // Run AI scoring engine
    const scoringStart = performance.now()
    const approval = await scoreApplication(formData, uploads || {}, !!paymentId, supabase)
    const scoringDurationMs = Math.round(performance.now() - scoringStart)
    const documentsUnreadable = approval.decision === "documents_unreadable"
    const hasUserBypass = bypassedDocsFromValidator.length > 0
    // Auto-approve gate: must be (a) AI's own autoApprove=true, (b) no
    // documents_unreadable, AND (c) no user-bypassed docs (a bypass means
    // a human must look at the file, full stop).
    const allAiVerified = approval.autoApprove && !documentsUnreadable && !hasUserBypass
    const hasPendingReview = !allAiVerified
    const aiFlags = approval.flags
    const aiConfidence = documentsUnreadable
      ? "documents_unreadable"
      : approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"
    const applicationStatus = documentsUnreadable
      ? "documents_unreadable"
      : allAiVerified && paymentId ? "ai_approved" : hasPendingReview ? "pending_review" : "submitted"

    // Build structured manual_review_reason. Three branches, each prefixed
    // with a code from MANUAL_REVIEW_REASON_CODES so the reviewer queue chip
    // can parse it. Format: "<code>: <free-text detail>".
    let manualReviewReason: string | null = null
    if (hasUserBypass) {
      // Preserve the per-doc upstream cause in detail so reviewers can tell
      // which bypass was a service error vs a low-confidence reject. Chip
      // stays "user_bypass" because the action that landed it here was the
      // user's, regardless of upstream cause.
      const docList = bypassedDocsFromValidator
        .map(b => `${b.key} (${b.reason})`)
        .join(", ")
      manualReviewReason = formatManualReviewReason(
        "user_bypass",
        `Applicant submitted ${docList} for manual review`,
      )
    } else if (documentsUnreadable) {
      // Pre-PR-0 this branch wrote raw text. Now: if the scorer marked any
      // doc as unreadable due to a service error upstream we still tag this
      // as ocr_service_error to help reviewers triage. Without an explicit
      // upstream signal, fall back to ocr_below_threshold.
      manualReviewReason = formatManualReviewReason(
        "ocr_below_threshold",
        approval.unreadableReason || "Required documents could not be read by OCR.",
      )
    } else if (hasPendingReview) {
      manualReviewReason = formatManualReviewReason(
        "ocr_below_threshold",
        `Score ${approval.totalScore}%. ${aiFlags.join("; ")}`,
      )
    }

    // Save application.
    //
    // WS-C: when WSC_EARLY_APPLICATION_ENABLED is on, the applicant created a
    // skeleton membership_applications row at status='pending_payment' BEFORE
    // paying (api/applications/create-pending), keyed by this same
    // reference_number. We FINALIZE that row in place rather than INSERT a
    // second one — a second insert for the same (email, membership_type) would
    // violate the partial unique index idx_unique_active_application
    // (status NOT IN ('rejected','withdrawn')). When the flag is off no such
    // row exists and we fall through to the original insert, so this branch is
    // a no-op in production until the flag flips.
    const applicationRow = buildApplicationRow({
      referenceNumber,
      formData,
      uploads,
      paymentId,
      emailVerified,
      mobileVerified,
      allAiVerified,
      documentsUnreadable,
      approval,
      aiConfidence,
      aiFlags,
      hasPendingReview,
      manualReviewReason,
      applicationStatus,
    })

    const { data: pendingRow } = await supabase
      .from("membership_applications")
      .select("id")
      .eq("reference_number", referenceNumber)
      .eq("status", "pending_payment")
      .maybeSingle()

    let app: { id: string } | null = null
    let insertError: { message: string; code?: string } | null = null

    if (pendingRow) {
      // Finalize the early row. The status guard makes this idempotent: a
      // concurrent finalize (or a Razorpay-driven retry) that already promoted
      // the row out of pending_payment matches zero rows here.
      const { data: finalized, error: finalizeErr } = await supabase
        .from("membership_applications")
        .update({ ...applicationRow, updated_at: new Date().toISOString() })
        .eq("id", pendingRow.id)
        .eq("status", "pending_payment")
        .select("id")
        .maybeSingle()

      if (finalizeErr) {
        insertError = finalizeErr
      } else if (finalized) {
        app = finalized
      } else {
        // Lost the finalize race — another request already promoted this row.
        // Return its current outcome instead of re-scoring / re-approving (which
        // could double-run auto-approval).
        const { data: current } = await supabase
          .from("membership_applications")
          .select("id, status")
          .eq("reference_number", referenceNumber)
          .maybeSingle()
        if (current?.id) {
          const approved = current.status === "approved" || current.status === "ai_approved"
          return Response.json({
            status: true,
            approved,
            applicationId: current.id,
            message: approved ? "Application already approved." : "Application already submitted.",
          })
        }
        insertError = { message: "pending_payment row vanished during finalize" }
      }
    } else {
      const ins = await supabase
        .from("membership_applications")
        .insert(applicationRow)
        .select("id")
        .single()

      if (ins.error?.code === "23505") {
        // Hit idx_unique_active_application — an active (non-rejected,
        // non-withdrawn) row already exists for (email, membership_type).
        // Two cases the client can't distinguish at the network layer:
        //
        //   a) Same reference_number → this IS our own retry. The first
        //      attempt's INSERT landed but the client never saw the 200
        //      (network blip / Vercel timeout). The client's loop then
        //      raced the index, the index correctly rejected the duplicate
        //      with 23505, and we used to surface that as a generic 500
        //      → status:false → client gave up → fatal "apply: paid but
        //      submit failed after retries" (AMASI-MEMBERSHIP-3A) on a
        //      user whose data is fine. Mirror the WS-C lost-race shape
        //      (lines ~287-321) and return the success envelope so the
        //      client lands on the success screen.
        //
        //   b) Different reference_number → there's a separate active
        //      application for this (email, type) — the user already
        //      applied. 409 + retryable:false so the client (once
        //      updated) breaks out of the retry loop instead of looping
        //      uselessly and showing the same fatal toast.
        //
        // Match by the exact values the insert used; the index is on raw
        // text columns (no lower/trim), so any normalization here would
        // miss the conflict row.
        const { data: existing } = await supabase
          .from("membership_applications")
          .select("id, status, reference_number")
          .eq("email", formData.email)
          .eq("membership_type", formData.membershipType)
          .not("status", "in", '("rejected","withdrawn")')
          .maybeSingle()

        if (existing?.id && existing.reference_number === referenceNumber) {
          const approved =
            existing.status === "approved" || existing.status === "ai_approved"
          return Response.json({
            status: true,
            approved,
            applicationId: existing.id,
            message: approved
              ? "Application already approved."
              : "Application already submitted.",
          })
        }

        if (existing?.id) {
          return Response.json(
            {
              status: false,
              retryable: false,
              code: "duplicate_active_application",
              message: "An active application already exists for this email.",
            },
            { status: 409 },
          )
        }

        // 23505 raised but the active row vanished between the failed
        // INSERT and our re-read (status flipped to rejected/withdrawn
        // mid-flight, or some other unique index fired). Surface as a
        // genuine failure rather than silently succeeding.
        insertError = ins.error
      } else {
        app = ins.data
        insertError = ins.error
      }
    }

    if (insertError) {
      console.error("Application insert error:", insertError)
      Sentry.captureException(insertError, {
        level: "fatal",
        tags: { route: "applications/submit", op: "application_insert_failure" },
        extra: { referenceNumber, paymentId, finalize: !!pendingRow },
      })
      return Response.json({ status: false, message: "Failed to save application" }, { status: 500 })
    }

    const applicationId: string | undefined = app?.id

    if (applicationId) {
      await logAiDecision(supabase, {
        applicationId,
        applicationReference: referenceNumber,
        membershipType: formData.membershipType,
        formData,
        uploads: uploads || {},
        paymentPaid: !!paymentId,
      }, approval, scoringDurationMs, null).catch(err => console.error("[submit] ai decision log failed:", err))

      void recordStepEvent({
        email: formData.email || "",
        applicationId,
        eventType: "submit",
        step: 6,
        status: documentsUnreadable ? "documents_unreadable" : allAiVerified ? "auto_approved" : "pending_review",
        metadata: {
          reference_number: referenceNumber,
          membership_type: formData.membershipType,
          ai_confidence: approval.totalScore,
          ai_auto_approve: approval.autoApprove,
          blocking_reasons: approval.blockingReasons,
          unreadable_docs: approval.unreadableDocs || null,
        },
      }, supabase)
    }

    // Clean up draft application on successful insert
    try {
      const { error: draftDeleteError } = await supabase
        .from("draft_applications")
        .delete()
        .eq("email", emailKey)
        .in("status", ["in_progress", "stuck", "resumed", "completed"])
      if (draftDeleteError) {
        Sentry.captureException(draftDeleteError, {
          tags: { route: "applications/submit", op: "draft-cleanup" },
          extra: { emailKey, applicationId },
        })
      }
    } catch (draftDeleteThrown) {
      Sentry.captureException(draftDeleteThrown, {
        tags: { route: "applications/submit", op: "draft-cleanup" },
        extra: { emailKey, applicationId },
      })
      // Draft cleanup failure is non-blocking
    }

    // Link payment record to this application
    if (paymentId && applicationId) {
      const { error: linkError } = await supabase
        .from("membership_payments")
        .update({ application_id: applicationId })
        .eq("gateway_payment_id", paymentId)
      if (linkError) console.error("Payment link error:", linkError.message)
    }

    // --- Notify admins of new application ---
    notifyAdminsNewApplication({
      applicantName: `${formData.salutation} ${formData.firstName} ${formData.lastName}`.trim(),
      email: formData.email,
      membershipType: formData.membershipType,
      referenceNumber,
      applicationId: applicationId || "",
      aiConfidence,
      needsManualReview: hasPendingReview,
    }).catch(err => console.error("Admin notification error:", err))

    // --- AI AUTO-APPROVAL ---
    if (allAiVerified && paymentId && applicationId) {
      const reviewNotes = `AI auto-approved — Score: ${approval.totalScore}%. ${approval.checks.map(c => `${c.check}: ${c.score}%`).join(", ")}`

      const result = await autoApproveApplication(supabase, {
        applicationId,
        referenceNumber,
        salutation: formData.salutation,
        firstName: formData.firstName,
        middleName: formData.middleName,
        lastName: formData.lastName,
        fatherName: formData.fatherName,
        dateOfBirth: formData.dob || null,
        gender: formData.gender,
        nationality: formData.nationality,
        email: formData.email,
        phone: formData.mobile || null,
        mobileCode: formData.mobileCode,
        membershipType: formData.membershipType,
        streetAddress1: formData.streetLine1,
        streetAddress2: formData.streetLine2,
        city: formData.city,
        state: formData.state,
        country: formData.country || "India",
        postalCode: formData.pin,
        zone: formData.zone,
        ugDegree: formData.eduUndergradDegree,
        ugCollege: formData.eduUndergradCollege,
        ugUniversity: formData.eduUndergradUniversity,
        ugYear: formData.eduUndergradYear,
        pgDegree: formData.eduPostgradDegree,
        pgCollege: formData.eduPostgradCollege,
        pgUniversity: formData.eduPostgradUniversity,
        pgYear: formData.eduPostgradYear,
        ssDegree: formData.eduSuperspecialtyDegree,
        mciCouncilNumber: formData.mciCouncilNumber,
        mciCouncilState: formData.mciCouncilState,
        imrRegistrationNo: formData.imrRegNo,
        asiMembershipNo: formData.asiMembershipNo,
        asiState: formData.asiState,
        reviewNotes,
        profilePhoto: (() => {
          const u = uploads || {}
          return u.profile?.fileUrl || u.photo?.fileUrl || u.photo?.url || u.profile?.url || null
        })(),
        mciCertificateUrl: (uploads || {}).mci_certificate?.fileUrl || (uploads || {}).mci_certificate?.url || null,
        pgDegreeCertificateUrl: (uploads || {}).pg_degree_certificate?.fileUrl || (uploads || {}).pg_degree_certificate?.url || null,
        asiMemberCertificateUrl: (uploads || {}).asi_member_certificate?.fileUrl || (uploads || {}).asi_member_certificate?.url || null,
        mbbsDegreeCertificateUrl: (uploads || {}).mbbs_degree_certificate?.fileUrl || (uploads || {}).mbbs_degree_certificate?.url || null,
        letterHodUrl: (uploads || {}).letter_hod?.fileUrl || (uploads || {}).letter_hod?.url || null,
        activeLicenseUrl: (uploads || {}).active_license?.fileUrl || (uploads || {}).active_license?.url || null,
      })

      if (!result.success) {
        // Helper already logged the root cause. Stage tells us what to do.
        if (result.stage === "sequence") {
          // No member was created and no mutation beyond the original app insert.
          // Same behavior as the old inline path: surface a 500.
          return Response.json(
            { status: false, message: "Failed to assign membership number" },
            { status: 500 },
          )
        }

        // member_insert failed (application_update failures are treated as success by the helper).
        // Fall back to pending_review so an admin can retry.
        const { error: submitFallbackErr } = await supabase
          .from("membership_applications")
          .update({
            status: "pending_review",
            needs_manual_review: true,
            manual_review_reason: `AI approved but member creation failed: ${result.reason}`,
          })
          .eq("id", applicationId)
        if (submitFallbackErr) {
          Sentry.captureException(submitFallbackErr, {
            tags: { route: "applications/submit", op: "submit-fallback-update" },
            extra: { applicationId },
          })
        }

        await updateAiDecisionOutcome(supabase, applicationId, {
          finalStatus: "auto_approve_failed",
          finalStatusBy: "ai",
          overrideReason: `member creation failed: ${result.reason}`,
        }).catch(err => console.error("[submit] decision outcome update failed:", err))

        return Response.json({
          status: true,
          approved: false,
          applicationId,
          message: "Application submitted. Requires manual review due to a processing issue.",
        })
      }

      await updateAiDecisionOutcome(supabase, applicationId, {
        finalStatus: "approved",
        finalStatusBy: "ai",
      }).catch(err => console.error("[submit] decision outcome update failed:", err))

      return Response.json({
        status: true,
        approved: true,
        amasiNumber: result.amasiNumber,
        applicationId,
        message: "Application approved! Membership number assigned.",
      })
    }

    // --- MANUAL REVIEW NEEDED ---
    // Send WhatsApp: Application Submitted
    await sendApplicationSubmittedWhatsApp(
      formData.mobile,
      `${formData.salutation} ${formData.firstName} ${formData.lastName}`.trim()
    ).catch(err => console.error("WhatsApp submit error:", err))

    // Send confirmation email (pending review)
    try {
      const resend = getResend()
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: formData.email,
        subject: `AMASI Application Received — ${referenceNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a;">Application Under Review</h2>
            <p style="color: #555;">Dear ${escapeHtml(formData.salutation)} ${escapeHtml(formData.firstName)},</p>
            <p style="color: #555;">Your application (${referenceNumber}) has been received and payment confirmed. Our admin team will review your documents and approve your membership shortly.</p>
            <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: #92400e; font-weight: bold; margin: 0;">Status: Under Manual Review</p>
              <p style="color: #92400e; font-size: 14px; margin: 4px 0 0;">Some documents require manual verification. We'll notify you once approved.</p>
            </div>
            ${(hasUserBypass || documentsUnreadable) ? `
              <div style="background: #ecfeff; border: 1px solid #a5f3fc; border-radius: 8px; padding: 16px; margin: 16px 0;">
                <p style="color: #155e75; font-weight: 600; margin: 0; font-size: 14px;">Manual review SLA</p>
                <p style="color: #155e75; font-size: 13px; margin: 6px 0 0;">
                  Some of your documents were flagged for manual verification. Our team will review them within 2 business days and contact you if anything is needed.
                </p>
              </div>
            ` : ""}
            <p style="color: #999; font-size: 12px;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Confirmation email error:", emailErr)
    }

    return Response.json({
      status: true,
      approved: false,
      applicationId,
      message: "Application submitted. Documents will be reviewed by our admin team.",
    })
  } catch (error) {
    console.error("Application submit error:", error)
    Sentry.captureException(error, { tags: { flow: "application_submit" } })
    return Response.json({ status: false, message: "Failed to submit application" }, { status: 500 })
  }
}
