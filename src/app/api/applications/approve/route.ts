import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { Resend } from "resend"
import { sendMemberApprovedWhatsApp } from "@/lib/whatsapp"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const { applicationId, notes } = await request.json()

    if (!applicationId) {
      return Response.json({ status: false, message: "Application ID required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch application
    const { data: app, error } = await supabase
      .from("membership_applications")
      .select("*")
      .eq("id", applicationId)
      .single()

    if (error || !app) {
      return Response.json({ status: false, message: "Application not found" }, { status: 404 })
    }

    if (app.status === "approved") {
      return Response.json({ status: false, message: "Already approved" }, { status: 400 })
    }

    // Create member record with retry loop for AMASI number race condition (Bug 1)
    const fullName = [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") || app.name
    const memberId = crypto.randomUUID() // Bug 2: generate UUID to use as member_id

    let nextAmasiNumber: number | null = null
    const MAX_RETRIES = 3

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Get next AMASI number
      const { data: maxNum } = await supabase
        .from("members")
        .select("amasi_number")
        .order("amasi_number", { ascending: false })
        .limit(1)
        .single()

      const candidateNumber = (maxNum?.amasi_number || 18135) + 1

      // Bug 3: check insert error; Bug 4: store phone as string
      const { error: insertError } = await supabase.from("members").insert({
        id: memberId,
        amasi_number: candidateNumber,
        name: fullName,
        email: app.email,
        phone: app.phone || null,
        mobile_code: app.mobile_code,
        membership_type: app.membership_type,
        status: "active",
        voting_eligible: app.membership_type === "LM",
        salutation: app.salutation,
        father_name: app.father_name,
        date_of_birth: app.date_of_birth,
        nationality: app.nationality,
        gender: app.gender,
        application_no: app.reference_number || app.application_number,
        application_date: new Date().toISOString().split("T")[0],
        street_address_1: app.street_address_1,
        street_address_2: app.street_address_2,
        city: app.city,
        state: app.state,
        country: app.country,
        postal_code: app.postal_code,
        zone: app.zone,
        edu_undergrad_degree: app.ug_degree,
        ug_college: app.ug_college,
        ug_university: app.ug_university,
        ug_year: app.ug_year,
        pg_degree: app.pg_degree,
        pg_college: app.pg_college,
        pg_university: app.pg_university,
        pg_year: app.pg_year,
        edu_superspecialty_degree: app.ss_degree,
        mci_council_number: app.mci_council_number,
        mci_council_state: app.mci_council_state,
        imr_registration_no: app.imr_registration_no,
        asi_membership_no: app.asi_membership_no,
        asi_state: app.asi_state,
        joining_date: new Date().toISOString().split("T")[0],
      })

      if (!insertError) {
        nextAmasiNumber = candidateNumber
        break
      }

      // If duplicate AMASI number, retry
      if (insertError.message?.includes("duplicate") || insertError.code === "23505") {
        console.warn(`AMASI number ${candidateNumber} conflict, retrying (attempt ${attempt + 1})`)
        continue
      }

      // Non-duplicate error: fail immediately
      console.error("Member insert error:", insertError)
      return Response.json({ status: false, message: "Failed to create member record" }, { status: 500 })
    }

    if (nextAmasiNumber === null) {
      return Response.json({ status: false, message: "Failed to assign AMASI number after retries" }, { status: 500 })
    }

    // Update application — Bug 2: use memberId UUID, Bug 5: check update error
    const { error: updateError } = await supabase
      .from("membership_applications")
      .update({
        status: "approved",
        assigned_amasi_number: nextAmasiNumber,
        reviewed_at: new Date().toISOString(),
        review_notes: notes || "Manually approved by admin",
        member_id: memberId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)

    if (updateError) {
      console.error("Application update error:", updateError)
      return Response.json({ status: false, message: "Member created but failed to update application" }, { status: 500 })
    }

    // Send welcome email
    try {
      const resend = getResend()
      const memberType = app.membership_type === "LM" ? "Life Member" :
        app.membership_type === "ALM" ? "Associate Life Member" :
        app.membership_type === "ACM" ? "Associate Candidate Member" : "International Life Member"

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: app.email,
        subject: `Welcome to AMASI — Membership #${nextAmasiNumber}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
              <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
            </div>
            <h2 style="color: #1a1a1a;">Welcome, ${app.salutation || "Dr."} ${app.first_name || app.name}!</h2>
            <p style="color: #555;">Your AMASI membership has been <strong style="color: #16a34a;">approved</strong>.</p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Your Membership Number</p>
              <p style="font-size: 36px; font-weight: bold; color: #0f766e; margin: 0; font-family: monospace;">${nextAmasiNumber}</p>
              <p style="color: #666; font-size: 13px; margin: 8px 0 0;">${memberType}</p>
            </div>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Welcome email error:", emailErr)
    }

    // Send WhatsApp: Membership Approved
    if (app.phone) {
      const memberType = app.membership_type === "LM" ? "Life Member" :
        app.membership_type === "ALM" ? "Associate Life Member" :
        app.membership_type === "ACM" ? "Associate Candidate Member" : "International Life Member"
      await sendMemberApprovedWhatsApp(
        app.phone,
        `${app.salutation || "Dr."} ${app.first_name || app.name}`.trim(),
        memberType,
        String(nextAmasiNumber)
      ).catch(err => console.error("WhatsApp approve error:", err))
    }

    // Audit log
    await logAdminAction({
      adminEmail: (session?.email as string) || "unknown",
      adminName: (session?.name as string) || undefined,
      action: "approve_application",
      entityType: "application",
      entityId: applicationId,
      entityName: fullName,
      details: { amasiNumber: nextAmasiNumber, membershipType: app.membership_type },
    })

    return Response.json({
      status: true,
      amasiNumber: nextAmasiNumber,
      message: `Approved! Membership #${nextAmasiNumber} assigned.`,
    })
  } catch (error: any) {
    console.error("Approve error:", error)
    return Response.json({ status: false, message: error.message }, { status: 500 })
  }
}
