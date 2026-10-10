// @auth: admin — counters for the post-event report row on
// /admin/mou-applications (awaiting review / overdue / etc.).
import { getAdminSession } from "@/lib/auth"
import { getReportSummary } from "@/lib/mou/supabase-helpers"

export async function GET() {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  try {
    const summary = await getReportSummary()
    return Response.json({ status: true, ...summary })
  } catch (error: unknown) {
    console.error("[mou-report-summary] failed:", error instanceof Error ? error.message : error)
    return Response.json({ status: false, message: "Failed to load report summary" }, { status: 500 })
  }
}
