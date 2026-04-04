import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { message, author_name: clientAuthorName } = body

    if (!message) {
      return Response.json(
        { error: "Missing required field: message" },
        { status: 400 }
      )
    }

    // Determine admin status from server-side session, not client
    const adminSession = await getAdminSession()
    const is_admin = !!adminSession
    const author_name = adminSession
      ? (adminSession.name as string) || "AMASI Admin"
      : clientAuthorName

    if (!author_name) {
      return Response.json(
        { error: "Missing required field: author_name" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const isUuid = UUID_REGEX.test(id)

    // Resolve ticket to get the uuid
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select("id, status")
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

    return Response.json(reply, { status: 201 })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
