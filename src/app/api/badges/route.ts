import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ pending: 0, tickets: 0, upgrades: 0 })
    }

    const supabase = createAdminClient()

    const [pendingRes, ticketsRes, upgradesRes] = await Promise.all([
      supabase
        .from("membership_applications")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "submitted", "pending_review"]),
      supabase
        .from("support_tickets")
        .select("*", { count: "exact", head: true })
        .eq("status", "open"),
      supabase
        .from("membership_upgrades")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "pending_review"]),
    ])

    return Response.json({
      pending: pendingRes.count ?? 0,
      tickets: ticketsRes.count ?? 0,
      upgrades: upgradesRes.count ?? 0,
    })
  } catch {
    return Response.json({ pending: 0, tickets: 0, upgrades: 0 })
  }
}
