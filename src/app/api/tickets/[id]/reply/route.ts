import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { Resend } from "resend"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Support both JSON and FormData (for file attachments)
    let message = ""
    let clientAuthorName = ""
    let asMember = false
    let attachmentUrl: string | null = null

    const contentType = request.headers.get("content-type") || ""
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData()
      message = (formData.get("message") as string) || ""
      clientAuthorName = (formData.get("author_name") as string) || ""
      asMember = (formData.get("as_member") as string) === "true"

      const file = formData.get("attachment") as File | null
      if (file && file.size > 0) {
        const supabaseUpload = createAdminClient()
        const ext = file.name.split(".").pop() || "png"
        const path = `tickets/${id}/reply_${Date.now()}.${ext}`
        const { error: uploadErr } = await supabaseUpload.storage.from("uploads").upload(path, file, { upsert: true })
        if (!uploadErr) {
          const { data: urlData } = supabaseUpload.storage.from("uploads").getPublicUrl(path)
          attachmentUrl = urlData.publicUrl
        }
      }
    } else {
      const body = await request.json()
      message = body.message || ""
      clientAuthorName = body.author_name || ""
      asMember = body.as_member === true
    }

    if (!message && !attachmentUrl) {
      return Response.json(
        { error: "Missing required field: message" },
        { status: 400 }
      )
    }

    // Determine admin status — respect as_member flag from member portal
    const adminSession = await getAdminSession()
    const is_admin = asMember ? false : !!adminSession
    const author_name = (is_admin && adminSession)
      ? (adminSession.name as string) || "AMASI Admin"
      : clientAuthorName

    if (!author_name) {
      return Response.json(
        { error: "Missing required field: author_name" },
        { status: 400 }
      )
    }

    // Append attachment link to message if uploaded
    if (attachmentUrl) {
      message = message ? `${message}\n\n📎 Attachment: ${attachmentUrl}` : `📎 Attachment: ${attachmentUrl}`
    }

    const supabase = createAdminClient()
    const isUuid = UUID_REGEX.test(id)

    // Resolve ticket to get the uuid + email for notifications
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select("id, status, email, name, ticket_number, subject")
      .eq(isUuid ? "id" : "ticket_number", id)
      .single()

    if (ticketError || !ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    // Insert the reply
    const { data: reply, error: replyError } = await supabase
      .from("ticket_replies")
      .insert({
        ticket_id: ticket.id,
        message,
        is_admin: Boolean(is_admin),
        author_name,
      })
      .select()
      .single()

    if (replyError) {
      return Response.json({ error: replyError.message }, { status: 500 })
    }

    // If admin reply on an open ticket, move to in_progress
    if (is_admin && ticket.status === "open") {
      await supabase
        .from("support_tickets")
        .update({
          status: "in_progress",
          updated_at: new Date().toISOString(),
        })
        .eq("id", ticket.id)
    }

    // Send email notification
    if (is_admin && ticket.email) {
      // Admin replied → notify member
      try {
        const resend = new Resend(process.env.RESEND_API_KEY?.trim())
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: ticket.email,
          subject: `AMASI Support — Reply on ${ticket.ticket_number}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #0f766e; margin: 0 0 4px;">AMASI Support</h2>
              <p style="color: #999; font-size: 12px; margin: 0 0 20px;">Ticket ${ticket.ticket_number}</p>
              <p style="color: #555;">Dear ${ticket.name || "Member"},</p>
              <p style="color: #555;">We have replied to your support ticket: <strong>${ticket.subject}</strong></p>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #166534; font-weight: bold; margin: 0 0 4px;">AMASI Admin</p>
                <p style="color: #166534; margin: 0; white-space: pre-wrap;">${message}</p>
              </div>
              <p style="color: #555; font-size: 14px;">You can reply to this ticket from your <a href="https://amasi-membership.vercel.app/member" style="color: #0f766e;">Member Portal</a>.</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          `,
        })
      } catch (emailErr) {
        console.error("Ticket reply email error:", emailErr)
      }
    }

    // Audit log for admin replies
    if (is_admin && adminSession) {
      await logAdminAction({
        adminEmail: (adminSession.email as string) || "unknown",
        adminName: (adminSession.name as string) || undefined,
        action: "reply_ticket",
        entityType: "ticket",
        entityId: ticket.id,
        entityName: ticket.ticket_number || ticket.subject,
        details: { subject: ticket.subject },
      })
    }

    return Response.json(reply, { status: 201 })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
