import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { Resend } from "resend"
import { scoreApplication } from "@/lib/ai-approval"
import { sendApplicationSubmittedWhatsApp, sendMemberApprovedWhatsApp } from "@/lib/whatsapp"

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
        payment_status: paymentId ? "paid" : "pending",
        payment_id: paymentId || null,
        email_verified: true,
        mobile_verified: true,
        ai_verified: allAiVerified,
        ai_confidence: `${approval.totalScore}% — ${aiConfidence}`,
        ai_flags: [...aiFlags, ...approval.checks.map(c => `${c.check}: ${c.score}% ${c.passed ? "✓" : "✗"} — ${c.detail}`)],
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

    const applicationId = app?.id

    // --- AI AUTO-APPROVAL ---
    if (allAiVerified && paymentId) {
      // All docs verified by AI + payment done → auto-approve
      // Get next AMASI number
      const { data: maxNum } = await supabase
        .from("members")
        .select("amasi_number")
        .order("amasi_number", { ascending: false })
        .limit(1)
        .single()

      const nextAmasiNumber = (maxNum?.amasi_number || 18135) + 1

      // Create member record
      const fullName = [formData.firstName, formData.middleName, formData.lastName].filter(Boolean).join(" ")
      const { error: memberInsertError } = await supabase.from("members").insert({
        id: crypto.randomUUID(),
        amasi_number: nextAmasiNumber,
        name: fullName,
        email: formData.email,
        phone: formData.mobile || null,
        mobile_code: formData.mobileCode,
        membership_type: formData.membershipType,
        status: "active",
        voting_eligible: formData.membershipType === "LM",
        salutation: formData.salutation,
        father_name: formData.fatherName,
        date_of_birth: formData.dob || null,
        nationality: formData.nationality,
        gender: formData.gender,
        application_no: referenceNumber,
        application_date: new Date().toISOString().split("T")[0],
        street_address_1: formData.streetLine1,
        street_address_2: formData.streetLine2,
        city: formData.city,
        state: formData.state,
        country: formData.country || "India",
        postal_code: formData.pin,
        zone: formData.zone,
        edu_undergrad_degree: formData.eduUndergradDegree,
        ug_college: formData.eduUndergradCollege,
        ug_university: formData.eduUndergradUniversity,
        ug_year: formData.eduUndergradYear,
        pg_degree: formData.eduPostgradDegree,
        pg_college: formData.eduPostgradCollege,
        pg_university: formData.eduPostgradUniversity,
        pg_year: formData.eduPostgradYear,
        edu_superspecialty_degree: formData.eduSuperspecialtyDegree,
        mci_council_number: formData.mciCouncilNumber,
        mci_council_state: formData.mciCouncilState,
        imr_registration_no: formData.imrRegNo,
        asi_membership_no: formData.asiMembershipNo,
        asi_state: formData.asiState,
        joining_date: new Date().toISOString().split("T")[0],
      })

      // If member insert failed, fall back to pending_review instead of approving
      if (memberInsertError) {
        console.error("Auto-approval member insert failed:", memberInsertError)
        await supabase
          .from("membership_applications")
          .update({
            status: "pending_review",
            needs_manual_review: true,
            manual_review_reason: `AI approved but member creation failed: ${memberInsertError.message}`,
          })
          .eq("id", applicationId)

        return Response.json({
          status: true,
          approved: false,
          applicationId,
          message: "Application submitted. Requires manual review due to a processing issue.",
        })
      }

      // Update application with assigned number
      await supabase
        .from("membership_applications")
        .update({
          status: "approved",
          assigned_amasi_number: nextAmasiNumber,
          reviewed_by: null,
          reviewed_at: new Date().toISOString(),
          review_notes: `AI auto-approved — Score: ${approval.totalScore}%. ${approval.checks.map(c => `${c.check}: ${c.score}%`).join(", ")}`,
        })
        .eq("id", applicationId)

      // Send welcome email with membership number
      try {
        const resend = getResend()
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: formData.email,
          subject: `Welcome to AMASI — Membership #${nextAmasiNumber}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
                <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
              </div>
              <h2 style="color: #1a1a1a;">Welcome, ${formData.salutation} ${formData.firstName}!</h2>
              <p style="color: #555;">Your AMASI membership has been <strong style="color: #16a34a;">approved</strong>.</p>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Your Membership Number</p>
                <p style="font-size: 36px; font-weight: bold; color: #0f766e; margin: 0; font-family: monospace;">${nextAmasiNumber}</p>
                <p style="color: #666; font-size: 13px; margin: 8px 0 0;">${formData.membershipType === "LM" ? "Life Member" : formData.membershipType === "ALM" ? "Associate Life Member" : formData.membershipType === "ACM" ? "Associate Candidate Member" : "International Life Member"}</p>
              </div>
              <p style="color: #555; font-size: 14px;">Reference: ${referenceNumber}</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          `,
        })
      } catch (emailErr) {
        console.error("Welcome email error:", emailErr)
      }

      // Send WhatsApp: Membership Approved
      const memberType = formData.membershipType === "LM" ? "Life Member" :
        formData.membershipType === "ALM" ? "Associate Life Member" :
        formData.membershipType === "ACM" ? "Associate Candidate Member" : "International Life Member"
      await sendMemberApprovedWhatsApp(
        formData.mobile,
        `${formData.salutation} ${formData.firstName} ${formData.lastName}`.trim(),
        memberType,
        String(nextAmasiNumber)
      ).catch(err => console.error("WhatsApp approve error:", err))

      return Response.json({
        status: true,
        approved: true,
        amasiNumber: nextAmasiNumber,
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
