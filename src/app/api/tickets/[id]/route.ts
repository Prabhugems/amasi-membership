import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"

// UUID v4 pattern check
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const supabase = createAdminClient()

    // Look up by uuid or ticket_number
    const isUuid = UUID_REGEX.test(id)
    const ticketQuery = supabase
      .from("support_tickets")
      .select("*")
      .eq(isUuid ? "id" : "ticket_number", id)
      .single()

    const { data: ticket, error: ticketError } = await ticketQuery

    if (ticketError || !ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    const { data: replies, error: repliesError } = await supabase
      .from("ticket_replies")
      .select("*")
      .eq("ticket_id", ticket.id)
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
    const session = await getAdminSession()
    if (session) {
      await logAdminAction({
        adminEmail: (session.email as string) || "unknown",
        adminName: (session.name as string) || undefined,
        action: status === "closed" ? "close_ticket" : "update_ticket_status",
        entityType: "ticket",
        entityId: data.id,
        entityName: data.ticket_number || data.subject,
        details: { status, priority: priority || undefined },
      })
    }

    return Response.json(data)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
