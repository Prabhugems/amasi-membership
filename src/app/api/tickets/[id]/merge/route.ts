import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { id: sourceId } = await params
    const body = await request.json()
    const { targetTicketId } = body

    if (!targetTicketId) {
      return Response.json(
        { error: "targetTicketId is required" },
        { status: 400 }
      )
    }

    if (sourceId === targetTicketId) {
      return Response.json(
        { error: "Cannot merge a ticket into itself" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Fetch source ticket
    const { data: sourceTicket, error: sourceError } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", sourceId)
      .single()

    if (sourceError || !sourceTicket) {
      return Response.json({ error: "Source ticket not found" }, { status: 404 })
    }

    // Cannot merge a ticket that is already merged
    if (sourceTicket.merged_into) {
      return Response.json(
        { error: "Source ticket is already merged" },
        { status: 400 }
      )
    }

    // Fetch target ticket
    const { data: targetTicket, error: targetError } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", targetTicketId)
      .single()

    if (targetError || !targetTicket) {
      return Response.json({ error: "Target ticket not found" }, { status: 404 })
    }

    // Target ticket cannot be closed
    if (targetTicket.status === "closed") {
      return Response.json(
        { error: "Cannot merge into a closed ticket" },
        { status: 400 }
      )
    }

    // Target ticket cannot itself be merged
    if (targetTicket.merged_into) {
      return Response.json(
        { error: "Cannot merge into a ticket that is already merged" },
        { status: 400 }
      )
    }

    // 1. Move all replies from source to target
    const { error: moveError } = await supabase
      .from("ticket_replies")
      .update({ ticket_id: targetTicketId })
      .eq("ticket_id", sourceId)

    if (moveError) {
      return Response.json(
        { error: "Failed to move replies: " + moveError.message },
        { status: 500 }
      )
    }

    // 2. Add a system reply to the target ticket
    const { error: systemReplyError } = await supabase
      .from("ticket_replies")
      .insert({
        ticket_id: targetTicketId,
        message: `Merged from ticket ${sourceTicket.ticket_number}: ${sourceTicket.subject}`,
        is_admin: true,
        is_internal: false,
        author_name: "System",
      })

    if (systemReplyError) {
      console.error("Failed to insert system merge reply:", systemReplyError.message)
    }

    // 3. Update source ticket: mark as merged and closed, invalidate pending CSAT
    const { error: updateSourceError } = await supabase
      .from("support_tickets")
      .update({
        merged_into: targetTicketId,
        merged_at: new Date().toISOString(),
        status: "closed",
        updated_at: new Date().toISOString(),
        csat_token: null,
        csat_sent_at: null,
      })
      .eq("id", sourceId)

    if (updateSourceError) {
      return Response.json(
        { error: "Failed to update source ticket: " + updateSourceError.message },
        { status: 500 }
      )
    }

    // 4. Update the target ticket timestamp
    await supabase
      .from("support_tickets")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", targetTicketId)

    // 5. Fetch the updated target ticket with replies
    const { data: updatedTarget } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", targetTicketId)
      .single()

    // Audit log
    await logAdminAction({
      adminEmail: (session.email as string) || "unknown",
      adminName: (session.name as string) || undefined,
      action: "merge_ticket",
      entityType: "ticket",
      entityId: sourceId,
      entityName: sourceTicket.ticket_number || sourceTicket.subject,
      details: {
        sourceTicketNumber: sourceTicket.ticket_number,
        targetTicketId,
        targetTicketNumber: targetTicket.ticket_number,
      },
    })

    return Response.json({
      message: "Tickets merged successfully",
      target: updatedTarget,
    })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
