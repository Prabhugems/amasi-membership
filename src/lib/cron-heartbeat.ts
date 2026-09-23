import { createAdminClient } from "@/lib/supabase"

// Part B item 9: a minimal last-success/last-error ledger per job name
// (sql/053_cron_heartbeats.sql). Call at the end of every guarded cron run
// so src/app/api/cron/heartbeat-check/route.ts can detect a job that's
// stopped running at all — not just one that ran and failed (Sentry
// already covers that), but one that silently never fired (a schedule
// misconfiguration, a route dropped in a deploy, an unhandled throw
// before this line).
export async function recordHeartbeat(
  jobName: string,
  outcome: { success: true } | { success: false; error: string }
): Promise<void> {
  const supabase = createAdminClient()
  const nowISO = new Date().toISOString()
  const update = outcome.success
    ? { job_name: jobName, last_success_at: nowISO, updated_at: nowISO }
    : { job_name: jobName, last_error_at: nowISO, last_error_message: outcome.error, updated_at: nowISO }

  const { error } = await supabase.from("cron_heartbeats").upsert(update, { onConflict: "job_name" })
  // Never let a heartbeat-recording failure affect the job's own result —
  // this is purely observability, logged, not thrown.
  if (error) console.error(`[cron-heartbeat] failed to record for ${jobName}:`, error.message)
}
