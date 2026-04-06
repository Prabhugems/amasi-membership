import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { Resend } from "resend"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    const { applicationId, reason } = await request.json()

    if (!applicationId || !reason) {
      return Response.json({ status: false, message: "Application ID and reason required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    const { data: app, error } = await supabase
      .from("membership_applications")
      .select("*")
      .eq("id", applicationId)
      .single()

    if (error || !app) {
      return Response.json({ status: false, message: "Application not found" }, { status: 404 })
    }

    // Update application
    const { error: updateError } = await supabase
      .from("membership_applications")
      .update({
        status: "rejected",
        reviewed_at: new Date().toISOString(),
        review_notes: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)

    if (updateError) {
      console.error("Reject update error:", updateError)
      return Response.json({ status: false, message: "Failed to update application status" }, { status: 500 })
    }

    // Send rejection email
    try {
      const resend = getResend()
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: app.email,
        subject: `AMASI Application Update — ${app.reference_number || app.application_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a;">Application Update</h2>
            <p style="color: #555;">Dear ${app.salutation || "Dr."} ${app.first_name || app.name},</p>
            <p style="color: #555;">We regret to inform you that your AMASI membership application could not be approved at this time.</p>
            <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: #991b1b; font-weight: bold; margin: 0;">Reason</p>
              <p style="color: #991b1b; font-size: 14px; margin: 4px 0 0;">${reason}</p>
            </div>
            <p style="color: #555; font-size: 14px;">You may reapply with corrected documents. If you have questions, please contact us.</p>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Rejection email error:", emailErr)
    }

    // Audit log
    const session = await getAdminSession()
    const fullName = [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") || app.name
    await logAdminAction({
      adminEmail: (session?.email as string) || "unknown",
      adminName: (session?.name as string) || undefined,
      action: "reject_application",
      entityType: "application",
      entityId: applicationId,
      entityName: fullName,
      details: { reason },
    })

    return Response.json({ status: true, message: "Application rejected" })
  } catch (error: any) {
    console.error("Reject error:", error)
    return Response.json({ status: false, message: "Failed to reject application. Please try again." }, { status: 500 })
  }
}
