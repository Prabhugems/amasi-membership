import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"

// UUID v4 pattern check
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const MEMBER_TICKET_FIELDS =
  "id, ticket_number, subject, description, category, status, priority, name, email, created_at, updated_at, closed_at, sla_due_at, sla_breached, first_response_at, merged_into, merged_at"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Auth check FIRST — before any DB query
    const adminSession = await getAdminSession()
    const memberSession = await getMemberSession()
    const isAdmin = !!adminSession

    // Must be either admin or authenticated member (or provide email for unauthenticated member lookup)
    const callerEmail =
      (memberSession?.email as string) ||
      request.nextUrl.searchParams.get("email")

    if (!isAdmin && !callerEmail) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()
    const isUuid = UUID_REGEX.test(id)

    // Admins get all fields; members get a restricted set
    const selectFields = isAdmin ? "*" : MEMBER_TICKET_FIELDS

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select(selectFields)
      .eq(isUuid ? "id" : "ticket_number", id)
      .single()

    if (ticketError || !ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    // Non-admin: verify ownership via email match
    if (!isAdmin) {
      if (callerEmail!.toLowerCase() !== (ticket.email || "").toLowerCase()) {
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

    return Response.json({ ticket, replies })
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
    const { status, priority } = body

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

    return Response.json(data)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
