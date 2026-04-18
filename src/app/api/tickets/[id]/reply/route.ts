import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // === AUTH CHECK FIRST — before parsing body or uploading files ===
    const adminSession = await getAdminSession()
    const memberSession = await getMemberSession()
    const isAdmin = !!adminSession

    if (!isAdmin && !memberSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // === VERIFY TICKET EXISTS and caller has access ===
    const supabase = createAdminClient()
    const isUuid = UUID_REGEX.test(id)

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select("id, status, email, name, ticket_number, subject, first_response_at")
      .eq(isUuid ? "id" : "ticket_number", id)
      .single()

    if (ticketError || !ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    // Non-admin: verify ownership via member session email
    if (!isAdmin) {
      const memberEmail = memberSession?.email as string
      if (!memberEmail || memberEmail.toLowerCase() !== (ticket.email || "").toLowerCase()) {
        return Response.json({ error: "Ticket not found" }, { status: 404 })
      }
    }

    // Block replies on closed tickets for non-admins
    if ((ticket.status === "closed" || ticket.status === "resolved") && !isAdmin) {
      return Response.json({ error: "This ticket is closed and cannot receive replies" }, { status: 403 })
    }

    // === NOW parse the request body — auth and ownership verified ===
    let message = ""
    let clientAuthorName = ""
    let asMember = false
    let isInternal = false
    let attachmentUrl: string | null = null
    let replyAttachments: Array<{ url: string; filename: string; size: number }> = []

    const contentType = request.headers.get("content-type") || ""
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData()
      message = (formData.get("message") as string) || ""
      clientAuthorName = (formData.get("author_name") as string) || ""
      asMember = (formData.get("as_member") as string) === "true"
      isInternal = (formData.get("is_internal") as string) === "true"

      const file = formData.get("attachment") as File | null
      if (file && file.size > 0) {
        if (file.size > 10 * 1024 * 1024) {
          return Response.json({ error: "File exceeds 10 MB limit" }, { status: 400 })
        }
        const allowedTypes = ["image/png", "image/jpeg", "image/webp", "application/pdf"]
        if (!allowedTypes.includes(file.type)) {
          return Response.json({ error: "Only PNG, JPG, WebP, and PDF files are allowed" }, { status: 400 })
        }
        const ext = file.name.split(".").pop() || "png"
        const path = `tickets/${id}/reply_${Date.now()}.${ext}`
        const fileBuffer = Buffer.from(await file.arrayBuffer())
        const { error: uploadErr } = await supabase.storage.from("uploads").upload(path, fileBuffer, {
          contentType: file.type,
          upsert: true,
        })
        if (!uploadErr) {
          const { data: signedData } = await supabase.storage.from("uploads").createSignedUrl(path, 86400 * 30)
          attachmentUrl = signedData?.signedUrl || null
          if (!attachmentUrl) {
            console.error("Ticket attachment: signed URL creation failed for", path)
          }
        } else {
          console.error("Ticket attachment upload failed:", uploadErr.message)
        }
      }
    } else {
      const body = await request.json()
      message = body.message || ""
      clientAuthorName = body.author_name || ""
      asMember = body.as_member === true
      isInternal = body.is_internal === true
      if (Array.isArray(body.attachments)) {
        replyAttachments = body.attachments
          .filter(
            (a: unknown) =>
              a &&
              typeof a === "object" &&
              typeof (a as Record<string, unknown>).url === "string" &&
              typeof (a as Record<string, unknown>).filename === "string"
          )
          .slice(0, 3)
      }
    }

    if (!message && !attachmentUrl && replyAttachments.length === 0) {
      return Response.json(
        { error: "Missing required field: message" },
        { status: 400 }
      )
    }

    // Determine reply role — respect as_member flag from member portal
    const is_admin = asMember ? false : isAdmin

    // Only admins can create internal notes
    if (isInternal && !is_admin) {
      isInternal = false
    }

    // Admin replies use the session name; member replies use the ticket's name
    let author_name: string
    if (is_admin && adminSession) {
      author_name = (adminSession.name as string) || "AMASI Admin"
    } else {
      author_name = ticket.name || clientAuthorName || "Member"
    }

    // Append attachment link to message if uploaded
    if (attachmentUrl) {
      message = message ? `${message}\n\n📎 Attachment: ${attachmentUrl}` : `📎 Attachment: ${attachmentUrl}`
    }

    // Insert the reply
    const { data: reply, error: replyError } = await supabase
      .from("ticket_replies")
      .insert({
        ticket_id: ticket.id,
        message,
        is_admin: Boolean(is_admin),
        is_internal: Boolean(isInternal),
        author_name,
        ...(replyAttachments.length > 0 ? { attachments: replyAttachments } : {}),
      })
      .select()
      .single()

    if (replyError) {
      return Response.json({ error: replyError.message }, { status: 500 })
    }

    // If admin reply on an open ticket, move to in_progress + record first response
    if (is_admin && !isInternal) {
      const updates: Record<string, string> = { updated_at: new Date().toISOString() }
      if (ticket.status === "open") updates.status = "in_progress"
      if (!ticket.first_response_at) updates.first_response_at = new Date().toISOString()
      await supabase.from("support_tickets").update(updates).eq("id", ticket.id)
    }

    // Send admin notification when a member replies
    if (!is_admin) {
      try {
        const adminEmail =
          process.env.ADMIN_NOTIFICATION_EMAIL ||
          process.env.ADMIN_EMAIL ||
          "admin@amasi.org"
        const resend = new Resend(process.env.RESEND_API_KEY?.trim())
        const adminUrl = `https://amasi-membership.vercel.app/admin/tickets/${ticket.ticket_number}`
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: adminEmail,
          subject: `[AMASI] Member reply on ${ticket.ticket_number}: ${ticket.subject}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #0f766e; margin: 0 0 4px;">Member Reply</h2>
              <p style="color: #999; font-size: 12px; margin: 0 0 20px;">Ticket ${ticket.ticket_number} — ${ticket.subject}</p>
              <p style="color: #555;">From: <strong>${ticket.name || author_name}</strong> (${ticket.email || "no email"})</p>
              <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #1e40af; margin: 0; white-space: pre-wrap;">${escapeHtml(message.slice(0, 500))}${message.length > 500 ? "..." : ""}</p>
              </div>
              <p style="margin: 20px 0;"><a href="${adminUrl}" style="background: #0f766e; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">View Ticket in Admin</a></p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          `,
        })
      } catch (emailErr) {
        console.error("Admin notification email error (member reply):", emailErr)
      }
    }

    // Send email notification (skip for internal notes)
    if (is_admin && ticket.email && !isInternal) {
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
                <p style="color: #166534; margin: 0; white-space: pre-wrap;">${escapeHtml(message)}</p>
              </div>
              <p style="color: #555; font-size: 14px;">You can reply to this ticket from your <a href="https://amasi-membership.vercel.app/support/${ticket.ticket_number}" style="color: #0f766e;">Ticket Portal</a>.</p>
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
