import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const { applicationId, action, message } = await request.json()

    if (!applicationId || !action || !message) {
      return Response.json(
        { status: false, message: "Application ID, action, and message are required" },
        { status: 400 }
      )
    }

    if (action !== "need_clarification" && action !== "ask_resubmit" && action !== "internal_note") {
      return Response.json(
        { status: false, message: "Action must be 'need_clarification', 'ask_resubmit', or 'internal_note'" },
        { status: 400 }
      )
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

    if (["approved", "ai_approved", "rejected"].includes(app.status)) {
      return Response.json({ status: false, message: `Cannot request clarification on an application with status "${app.status}"` }, { status: 400 })
    }

    // Handle internal notes — no status change, no email
    if (action === "internal_note") {
      const existingNotes = Array.isArray(app.internal_notes) ? app.internal_notes : []
      const newNote = { text: message, date: new Date().toISOString() }

      const { error: noteError } = await supabase
        .from("membership_applications")
        .update({
          internal_notes: [...existingNotes, newNote],
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId)

      if (noteError) {
        console.error("Internal note update error:", noteError)
        return Response.json({ status: false, message: "Failed to save internal note" }, { status: 500 })
      }

      return Response.json({ status: true, message: "Internal note saved" })
    }

    const newStatus = action === "need_clarification" ? "need_clarification" : "resubmit_requested"

    const { error: updateError } = await supabase
      .from("membership_applications")
      .update({
        status: newStatus,
        review_notes: message,
        reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", applicationId)

    if (updateError) {
      console.error("Clarification update error:", updateError)
      return Response.json({ status: false, message: "Failed to update application status" }, { status: 500 })
    }

    // Send email to applicant
    try {
      const resend = getResend()
      const isClarification = action === "need_clarification"
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://application.amasi.org"
      const resubmitLink = `${appUrl}/apply/resubmit?ref=${app.reference_number}`

      const heading = isClarification
        ? "Additional Information Required"
        : "Application Resubmission Required"

      const intro = isClarification
        ? "We need additional information regarding your application."
        : "We need you to correct and resubmit your application."

      const boxBg = isClarification ? "#eff6ff" : "#fffbeb"
      const boxBorder = isClarification ? "#bfdbfe" : "#fde68a"
      const boxTextColor = isClarification ? "#1e40af" : "#92400e"

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: app.email,
        subject: `AMASI Application — Action Required — ${app.reference_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a;">${heading}</h2>
            <p style="color: #555;">Dear ${escapeHtml(app.salutation || "Dr.")} ${escapeHtml(app.first_name || app.name)},</p>
            <p style="color: #555;">${intro}</p>
            <div style="background: ${boxBg}; border: 1px solid ${boxBorder}; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: ${boxTextColor}; font-weight: bold; margin: 0;">Message from reviewer</p>
              <p style="color: ${boxTextColor}; font-size: 14px; margin: 4px 0 0;">${escapeHtml(message)}</p>
            </div>
            <p style="color: #555;">Please click the link below to review and update your application:</p>
            <p style="text-align: center; margin: 24px 0;">
              <a href="${resubmitLink}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;">Update Application</a>
            </p>
            <p style="color: #888; font-size: 13px;">If the button above doesn't work, copy and paste this link into your browser:<br /><a href="${resubmitLink}" style="color: #2563eb;">${resubmitLink}</a></p>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Clarification email error:", emailErr)
    }

    // Audit log
    const fullName = [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") || app.name
    await logAdminAction({
      adminEmail: (session?.email as string) || "unknown",
      adminName: (session?.name as string) || undefined,
      action: action === "need_clarification" ? "request_clarification" : action === "ask_resubmit" ? "request_resubmit" : "add_internal_note",
      entityType: "application",
      entityId: applicationId,
      entityName: fullName,
      details: { action, message },
    })

    const actionLabel = action === "need_clarification" ? "Clarification requested" : "Resubmission requested"
    return Response.json({ status: true, message: actionLabel })
  } catch (error: any) {
    console.error("Clarification/resubmit error:", error)
    return Response.json(
      { status: false, message: "Failed to process request. Please try again." },
      { status: 500 }
    )
  }
}
