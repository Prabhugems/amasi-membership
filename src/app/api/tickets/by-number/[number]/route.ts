import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  try {
    const { number } = await params
    const supabase = createAdminClient()

    const { data: ticket, error: ticketError } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("ticket_number", number)
      .single()

    if (ticketError || !ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 })
    }

    // Ownership check: admins can access any ticket; members must provide
    // the matching email as a query param to prove they own it.
    const adminSession = await getAdminSession()
    if (!adminSession) {
      const email = request.nextUrl.searchParams.get("email")
      if (!email || email.toLowerCase() !== (ticket.email || "").toLowerCase()) {
        return Response.json({ error: "Ticket not found" }, { status: 404 })
      }
    }

    // Fetch replies, always filter out internal notes for non-admins
    let replyQuery = supabase
      .from("ticket_replies")
      .select("*")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true })

    if (!adminSession) {
      replyQuery = replyQuery.eq("is_internal", false)
    }

    const { data: replies, error: repliesError } = await replyQuery

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
