import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { Resend } from "resend"
import { scoreApplication } from "@/lib/ai-approval"
import { sendApplicationSubmittedWhatsApp } from "@/lib/whatsapp"
import { autoApproveApplication } from "@/lib/auto-approval"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
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
    const sixtyMinAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
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
        .gte("created_at", sixtyMinAgo)
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
        .gte("created_at", sixtyMinAgo)
        .limit(1)
        .maybeSingle()
      mobileVerified = !!mobileOtp
    }

    if (!emailVerified && !mobileVerified) {
      return Response.json({ status: false, message: "Email/mobile not verified" }, { status: 401 })
    }

    // Run AI scoring engine
    const approval = await scoreApplication(formData, uploads || {}, !!paymentId)
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
          Object.entries(uploads || {}).map(([k, v]: [string, any]) => [k, { status: v.status, extracted: v.extracted, message: v.message }])
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

        return Response.json({
          status: true,
          approved: false,
          applicationId,
          message: "Application submitted. Requires manual review due to a processing issue.",
        })
      }

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
            <p style="color: #555;">Dear ${formData.salutation} ${formData.firstName},</p>
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
    return Response.json({ status: false, message: "Failed to submit application" }, { status: 500 })
  }
}
