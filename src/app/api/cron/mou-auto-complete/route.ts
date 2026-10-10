import { runMouAutoComplete } from "@/lib/mou-auto-complete"
import { recordHeartbeat } from "@/lib/cron-heartbeat"

// ---------------------------------------------------------------------------
// GET /api/cron/mou-auto-complete[?dryRun=true]
//
// Thin route wrapper — auth + dryRun parsing only, same shape as
// mou-report-reminders / mou-organiser-reminders. All logic lives in
// src/lib/mou-auto-complete.ts. Moves approved MOU applications to
// "completed" once the event has ended (IST). No emails or notifications.
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
    const summary = await runMouAutoComplete({ dryRun })
    // Dry runs don't count as a real heartbeat (see mou-report-reminders).
    if (!dryRun) await recordHeartbeat("mou-auto-complete", { success: true })
    return Response.json(summary)
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[mou-auto-complete] fatal error:", message)
    if (!dryRun) await recordHeartbeat("mou-auto-complete", { success: false, error: message })
    return Response.json({ error: "Auto-complete run failed" }, { status: 500 })
  }
}
