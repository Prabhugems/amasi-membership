// Hourly: alerts if a monitored MOU cron hasn't recorded a successful
// heartbeat in 36 hours (Part B item 9). Covers a job that's stopped
// firing entirely, not just one that ran and threw — Sentry.captureException
// at each job's own catch block already covers the latter.
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { sendMouAlertEmail } from "@/lib/mou/notify"

const MONITORED_JOBS = ["mou-report-reminders", "mou-weekly-digest"] as const
const STALE_AFTER_HOURS = 36
// Don't re-alert every hour once a job is stale — only once per this window.
const REALERT_AFTER_HOURS = 36

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim()
  const authHeader = request.headers.get("authorization")
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const supabase = createAdminClient()
  const { data: heartbeats, error } = await supabase
    .from("cron_heartbeats")
    .select("*")
    .in("job_name", MONITORED_JOBS)
  if (error) {
    console.error("[heartbeat-check] fetch failed:", error.message)
    return Response.json({ error: "Failed to fetch heartbeats" }, { status: 500 })
  }

  const now = Date.now()
  const staleMs = STALE_AFTER_HOURS * 60 * 60 * 1000
  const realertMs = REALERT_AFTER_HOURS * 60 * 60 * 1000
  const byJob = new Map((heartbeats ?? []).map((h) => [h.job_name, h]))

  const alerted: string[] = []
  for (const jobName of MONITORED_JOBS) {
    const row = byJob.get(jobName)
    const lastSuccessMs = row?.last_success_at ? new Date(row.last_success_at).getTime() : null
    const isStale = !lastSuccessMs || now - lastSuccessMs > staleMs
    if (!isStale) continue

    const lastAlertedMs = row?.last_alerted_at ? new Date(row.last_alerted_at).getTime() : null
    const alreadyAlertedRecently = lastAlertedMs !== null && now - lastAlertedMs < realertMs
    if (alreadyAlertedRecently) continue

    const hoursSince = lastSuccessMs ? Math.round((now - lastSuccessMs) / (60 * 60 * 1000)) : null
    const message = lastSuccessMs
      ? `MOU: ${jobName} hasn't run successfully in ${hoursSince}h (last success ${row?.last_success_at})`
      : `MOU: ${jobName} has no recorded successful run at all`

    Sentry.captureMessage(message, { level: "error", tags: { component: "mou-heartbeat-check", job: jobName } })
    console.error(`[heartbeat-check] ${message}`)
    await sendMouAlertEmail(`cron "${jobName}" hasn't run`, message)
    alerted.push(jobName)

    await supabase
      .from("cron_heartbeats")
      .upsert({ job_name: jobName, last_alerted_at: new Date().toISOString() }, { onConflict: "job_name" })
  }

  return Response.json({ checked: MONITORED_JOBS, alerted })
}
