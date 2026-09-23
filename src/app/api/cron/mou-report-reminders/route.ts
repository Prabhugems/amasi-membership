import { runMouReportReminders } from "@/lib/mou-report-reminders"

// ---------------------------------------------------------------------------
// GET /api/cron/mou-report-reminders[?dryRun=true]
//
// Thin route wrapper — auth + dryRun query-param parsing only, matching
// src/app/api/cron/cleanup-drafts/route.ts. All logic lives in
// src/lib/mou-report-reminders.ts.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true"

  try {
    const summary = await runMouReportReminders({ dryRun })
    return Response.json(summary)
  } catch (error: unknown) {
    console.error("[mou-report-reminders] fatal error:", error instanceof Error ? error.message : String(error))
    return Response.json({ error: "Reminder run failed" }, { status: 500 })
  }
}
