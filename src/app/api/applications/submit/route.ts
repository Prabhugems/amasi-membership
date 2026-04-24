import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { Resend } from "resend"
import { scoreApplication } from "@/lib/ai-approval"
import { sendApplicationSubmittedWhatsApp } from "@/lib/whatsapp"
import { autoApproveApplication } from "@/lib/auto-approval"
import { logAiDecision, updateAiDecisionOutcome, type AiDecisionInput } from "@/lib/ai-decision-log"
import { validateRequiredDocuments } from "@/lib/document-keys"
import { getMembershipType } from "@/lib/membership-types"
import { escapeHtml } from "@/lib/html-escape"

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

    // --- Auth gate 3: verify required documents are present ---
    const membershipType = getMembershipType(formData.membershipType)
    if (membershipType) {
      const docValidation = validateRequiredDocuments(uploads || {}, membershipType.requiredDocs)
      if (!docValidation.valid) {
        // Log to ai_decisions for tracking
        try {
          await logAiDecision(supabase, {
            applicationId: "rejected-pre-scoring",
            applicationReference: referenceNumber,
            membershipType: formData.membershipType,
            formData,
            uploads: uploads || {},
            paymentPaid: true,
          }, null, 0, { message: `Missing documents: ${docValidation.missing.join(", ")}` })
        } catch {}
        return Response.json({
          status: false,
          missingDocuments: docValidation.missing,
          message: `Application submission requires the following documents: ${docValidation.missing.join(", ")}. Please upload them and try again.`,
        }, { status: 400 })
      }
    }

    // Run AI scoring engine
    const scoringStart = performance.now()
    const approval = await scoreApplication(formData, uploads || {}, !!paymentId, supabase)
    const scoringDurationMs = Math.round(performance.now() - scoringStart)
    const allAiVerified = approval.autoApprove
    const hasPendingReview = !approval.autoApprove
    const aiFlags = approval.flags
    const aiConfidence = approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"

    // Save application
    const { data: app, error: insertError } = await supabase
      .from("membership_applications")
      .insert({
        reference_number: referenceNumber,
        salutation: formData.salutation,
        first_name: formData.firstName,
        middle_name: formData.middleName,
        last_name: formData.lastName,
        name: [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(" "),
        email: formData.email,
        phone: formData.mobile,
        mobile_code: formData.mobileCode || "+91",
        date_of_birth: formData.dob || null,
        gender: formData.gender,
        father_name: formData.fatherName,
        nationality: formData.nationality || "Indian",
        membership_type: formData.membershipType,
        street_address_1: formData.streetLine1,
        street_address_2: formData.streetLine2,
        city: formData.city,
        state: formData.state,
        country: formData.country || "India",
        postal_code: formData.pin,
        zone: formData.zone,
        ug_degree: formData.eduUndergradDegree,
        ug_college: formData.eduUndergradCollege,
        ug_university: formData.eduUndergradUniversity,
        ug_year: formData.eduUndergradYear,
        pg_degree: formData.eduPostgradDegree,
        pg_college: formData.eduPostgradCollege,
        pg_university: formData.eduPostgradUniversity,
        pg_year: formData.eduPostgradYear,
        ss_degree: formData.eduSuperspecialtyDegree,
        ss_college: formData.eduSuperspecialtyCollege,
        ss_university: formData.eduSuperspecialtyUniversity,
        ss_year: formData.eduSuperspecialtyYear,
        mci_council_number: formData.mciCouncilNumber,
        mci_council_state: formData.mciCouncilState,
        imr_registration_no: formData.imrRegNo,
        asi_membership_no: formData.asiMembershipNo,
        asi_state: formData.asiState,
        clinic_name: formData.clinicName,
        clinic_city: formData.clinicCity,
        clinic_state: formData.clinicState,
        intl_org_sages: formData.intlOrgSAGES,
        intl_org_elsa: formData.intlOrgELSA,
        intl_org_other: formData.intlOrgOther,
        payment_status: "paid",
        payment_id: paymentId,
        email_verified: emailVerified,
        mobile_verified: mobileVerified,
        ai_verified: allAiVerified,
        ai_confidence: `${approval.totalScore}% — ${aiConfidence}`,
        ai_flags: [...aiFlags, ...approval.checks.map(c => `${c.check}: ${c.score}% ${c.passed ? "✓" : "✗"} — ${c.detail}`)],
        nmc_verification: approval.nmcVerification,
        needs_manual_review: hasPendingReview,
        manual_review_reason: hasPendingReview ? `Score: ${approval.totalScore}%. ${aiFlags.join("; ")}` : null,
        documents: Object.fromEntries(
          Object.entries(uploads || {}).map(([k, v]: [string, any]) => [k, { status: v.status, extracted: v.extracted, message: v.message, fileUrl: v.fileUrl || null }])
        ),
        ocr_data: Object.fromEntries(
          Object.entries(uploads || {}).filter(([, v]: [string, any]) => v.extracted).map(([k, v]: [string, any]) => [k, v.extracted])
        ),
        status: allAiVerified && paymentId ? "ai_approved" : hasPendingReview ? "pending_review" : "submitted",
      })
      .select("id")
      .single()

    if (insertError) {
      console.error("Application insert error:", insertError)
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
    }

    // Clean up draft application on successful insert
    try {
      await supabase
        .from("draft_applications")
        .delete()
        .eq("email", emailKey)
        .in("status", ["in_progress", "stuck", "resumed", "completed"])
    } catch {
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
        await supabase
          .from("membership_applications")
          .update({
            status: "pending_review",
            needs_manual_review: true,
            manual_review_reason: `AI approved but member creation failed: ${result.reason}`,
          })
          .eq("id", applicationId)

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
  } catch (error: any) {
    console.error("Application submit error:", error)
    Sentry.captureException(error, { tags: { flow: "application_submit" } })
    return Response.json({ status: false, message: "Failed to submit application" }, { status: 500 })
  }
}
