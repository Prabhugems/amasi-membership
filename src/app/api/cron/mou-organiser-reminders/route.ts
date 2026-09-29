import { runWeeklySetupStatusEmails, run3DayEventReminders } from "@/lib/mou-organiser-reminders"
import { recordHeartbeat } from "@/lib/cron-heartbeat"

// ---------------------------------------------------------------------------
// GET /api/cron/mou-organiser-reminders[?dryRun=true]
//
// Runs daily. Both underlying functions are internally idempotency-guarded
// (see src/lib/mou-organiser-reminders.ts), so a daily schedule is what
// produces "weekly" cadence for the setup-status nudge and "exactly once,
// 3 days before" for the event reminder — same idiom as
// src/app/api/cron/mou-report-reminders/route.ts running multiple stages
// off one daily trigger.
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
    const [setupStatus, eventReminder] = await Promise.all([
      runWeeklySetupStatusEmails({ dryRun }),
      run3DayEventReminders({ dryRun }),
    ])
    if (!dryRun) await recordHeartbeat("mou-organiser-reminders", { success: true })
    return Response.json({ setupStatus, eventReminder })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[mou-organiser-reminders] fatal error:", message)
    if (!dryRun) await recordHeartbeat("mou-organiser-reminders", { success: false, error: message })
    return Response.json({ error: "Reminder run failed" }, { status: 500 })
  }
}
