import { createAdminClient } from "@/lib/supabase"

// force-dynamic so the count reflects live DB state on every poll
export const dynamic = "force-dynamic"

export async function GET() {
  const supabase = createAdminClient()
  const { count, error } = await supabase
    .from("members")
    .select("*", { count: "exact", head: true })

  if (error) {
    console.error("members/count error:", error)
    return Response.json({ error: "Failed to fetch count" }, { status: 500 })
  }

  return Response.json(
    { count: count ?? 0 },
    { headers: { "Cache-Control": "no-store" } }
  )
}
