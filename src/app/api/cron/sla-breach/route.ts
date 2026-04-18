import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("support_tickets")
    .update({ sla_breached: true })
    .lt("sla_due_at", new Date().toISOString())
    .is("first_response_at", null)
    .eq("sla_breached", false)
    .in("status", ["open", "in_progress"])
    .is("merged_into", null)
    .select("id, ticket_number, sla_due_at, priority")

  if (error) {
    console.error("SLA breach cron error:", error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const count = data?.length || 0
  if (count > 0) {
    console.log(`SLA breach cron: marked ${count} ticket(s) as breached:`, data?.map((t) => t.ticket_number).join(", "))
  }

  return Response.json({ breached: count, tickets: data?.map((t) => t.ticket_number) || [] })
}
