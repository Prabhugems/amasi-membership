import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("notification_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100)

    if (error) {
      console.error("Notification history error:", error)
      return Response.json({ status: false, message: "Failed to fetch history" }, { status: 500 })
    }

    return Response.json({ status: true, data: data || [] })
  } catch (error: any) {
    console.error("Notification history error:", error)
    return Response.json(
      { status: false, message: error.message || "Failed to fetch history" },
      { status: 500 }
    )
  }
}
