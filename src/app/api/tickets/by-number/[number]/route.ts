import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"

// Note: previously this route accepted email as an unauthenticated
// lookup parameter. Removed 2026-04-18 — email-based access must go
// through the permalink verification flow, not query params.

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
  _request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    const { number } = await params

    // Auth check FIRST — admin session (cookie) or member session (cookie, post-OTP)
    const adminSession = await getAdminSession()
    const memberSession = await getMemberSession()
    const isAdmin = !!adminSession

    if (!isAdmin && !memberSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("ticket_number", number)
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

    // Fetch replies, filter out internal notes for non-admins
    let replyQuery = supabase
      .from("ticket_replies")
      .select("*")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true })

    if (!isAdmin) {
      replyQuery = replyQuery.eq("is_internal", false)
    }

    const { data: replies, error: repliesError } = await replyQuery

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
