import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"
import { randomUUID } from "node:crypto"

// UUID v4 pattern check
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MEMBER_SAFE_KEYS = new Set([
  "id", "ticket_number", "subject", "description", "category", "status",
  "priority", "name", "email", "created_at", "updated_at", "closed_at",
  "sla_due_at", "sla_breached", "first_response_at", "merged_into", "merged_at",
])

function stripToMemberFields(ticket: Record<string, unknown>) {
  const safe: Record<string, unknown> = {}
  for (const key of MEMBER_SAFE_KEYS) {
    if (key in ticket) safe[key] = ticket[key]
  }
  return safe
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Auth check FIRST — admin session (cookie) or member session (cookie, post-OTP)
    const adminSession = await getAdminSession()
    const memberSession = await getMemberSession()
    const isAdmin = !!adminSession

    if (!isAdmin && !memberSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()
    const isUuid = UUID_REGEX.test(id)

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select("*")
      .eq(isUuid ? "id" : "ticket_number", id)
      .single()

    if (ticketError || !ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    // Non-admin: verify ownership via member session email
    if (!isAdmin) {
      const memberEmail = (memberSession!.email as string) || ""
      if (memberEmail.toLowerCase() !== (ticket.email || "").toLowerCase()) {
        return Response.json({ error: "Ticket not found" }, { status: 404 })
      }
    }

    // Lazy SLA breach detection — only for admins (they act on it)
    if (
      isAdmin &&
      ticket.sla_due_at &&
      !ticket.first_response_at &&
      !ticket.sla_breached &&
      new Date(ticket.sla_due_at).getTime() < Date.now()
    ) {
      ticket.sla_breached = true
      await supabase
        .from("support_tickets")
        .update({ sla_breached: true })
        .eq("id", ticket.id)
    }

    // Fetch replies — filter internal notes for non-admins
    let repliesQuery = supabase
      .from("ticket_replies")
      .select("*")
      .eq("ticket_id", ticket.id)

    if (!isAdmin) {
      repliesQuery = repliesQuery.eq("is_internal", false)
    }

    const { data: replies, error: repliesError } = await repliesQuery
      .order("created_at", { ascending: true })

    if (repliesError) {
      return Response.json({ error: repliesError.message }, { status: 500 })
    }

    const safeTicket = isAdmin ? ticket : stripToMemberFields(ticket)
    return Response.json({ ticket: safeTicket, replies })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()
    const { status, priority, assigned_to } = body

    if (!status) {
      return Response.json({ error: "status is required" }, { status: 400 })
    }

    const validStatuses = ["open", "in_progress", "resolved", "closed"]
    if (!validStatuses.includes(status)) {
      return Response.json(
        { error: `status must be one of: ${validStatuses.join(", ")}` },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const isUuid = UUID_REGEX.test(id)

    const updates: Record<string, unknown> = {
      status,
      updated_at: new Date().toISOString(),
    }

    if (priority) {
      const validPriorities = ["low", "normal", "high", "urgent"]
      if (!validPriorities.includes(priority)) {
        return Response.json(
          { error: `priority must be one of: ${validPriorities.join(", ")}` },
          { status: 400 }
        )
      }
      updates.priority = priority
    }

    if (assigned_to !== undefined) {
      updates.assigned_to = assigned_to === "Unassigned" ? null : assigned_to
    }

    // Set or clear closed_at based on status
    if (status === "resolved" || status === "closed") {
      updates.closed_at = new Date().toISOString()
    } else if (status === "open") {
      updates.closed_at = null
    }

    const { data, error } = await supabase
      .from("support_tickets")
      .update(updates)
      .eq(isUuid ? "id" : "ticket_number", id)
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    // Audit log
    await logAdminAction({
      adminEmail: (session.email as string) || "unknown",
      adminName: (session.name as string) || undefined,
      action: status === "closed" ? "close_ticket" : "update_ticket_status",
      entityType: "ticket",
      entityId: data.id,
      entityName: data.ticket_number || data.subject,
      details: { status, priority: priority || undefined },
    })

    // Send CSAT survey email when ticket is resolved (not closed, not merged, not already sent)
    if (
      status === "resolved" &&
      data.email &&
      !data.merged_into &&
      !data.csat_sent_at
    ) {
      try {
        const csatToken = randomUUID()
        await supabase
          .from("support_tickets")
          .update({ csat_token: csatToken, csat_sent_at: new Date().toISOString() })
          .eq("id", data.id)

        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://amasi-membership.vercel.app"
        const ratingUrl = (r: number) => `${baseUrl}/api/tickets/csat?token=${csatToken}&rating=${r}`
        const ticketName = escapeHtml(data.name || "Member")
        const ticketSubject = escapeHtml(data.subject || "your support ticket")

        const resend = new Resend(process.env.RESEND_API_KEY?.trim())
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: data.email,
          subject: `How was your experience? — ${data.ticket_number}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
              <h2 style="color: #0f766e; margin: 0 0 4px;">AMASI Support</h2>
              <p style="color: #999; font-size: 12px; margin: 0 0 20px;">Ticket ${data.ticket_number}</p>
              <p style="color: #555;">Dear ${ticketName},</p>
              <p style="color: #555;">Your support ticket <strong>${ticketSubject}</strong> has been resolved. We'd love to hear how we did!</p>
              <p style="color: #555; margin: 24px 0 8px;">How would you rate your experience?</p>
              <div style="text-align: center; margin: 16px 0 32px;">
                <a href="${ratingUrl(1)}" style="text-decoration: none; font-size: 32px; margin: 0 8px;" title="Very poor">😠</a>
                <a href="${ratingUrl(2)}" style="text-decoration: none; font-size: 32px; margin: 0 8px;" title="Poor">😕</a>
                <a href="${ratingUrl(3)}" style="text-decoration: none; font-size: 32px; margin: 0 8px;" title="Okay">😐</a>
                <a href="${ratingUrl(4)}" style="text-decoration: none; font-size: 32px; margin: 0 8px;" title="Good">😊</a>
                <a href="${ratingUrl(5)}" style="text-decoration: none; font-size: 32px; margin: 0 8px;" title="Excellent">🤩</a>
              </div>
              <p style="color: #999; font-size: 12px; text-align: center;">Click an emoji to rate. You can also leave a comment after rating.</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          `,
        })
      } catch (csatErr) {
        console.error("CSAT email send error:", csatErr)
      }
    }

    return Response.json(data)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
