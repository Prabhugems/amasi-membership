import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    const { number } = await params
    const supabase = createAdminClient()

    // Look up ticket by ticket_number (e.g. TKT-20260416-0042)
    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("ticket_number", number)
      .single()

    if (ticketError || !ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    // Fetch replies, filtering out internal notes
    // Note: is_internal filter is included — if the column does not exist yet, remove the .eq('is_internal', false) line
    const { data: replies, error: repliesError } = await supabase
      .from("ticket_replies")
      .select("*")
      .eq("ticket_id", ticket.id)
      .eq("is_internal", false)
      .order("created_at", { ascending: true })

    if (repliesError) {
      // If is_internal column doesn't exist, retry without the filter
      const { data: fallbackReplies, error: fallbackError } = await supabase
        .from("ticket_replies")
        .select("*")
        .eq("ticket_id", ticket.id)
        .order("created_at", { ascending: true })

      if (fallbackError) {
        return Response.json({ error: fallbackError.message }, { status: 500 })
      }

      return Response.json({ ticket, replies: fallbackReplies })
    }

    return Response.json({ ticket, replies })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
