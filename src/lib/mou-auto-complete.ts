import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { eventEndedAt, eventLastDay, shouldAutoComplete, todayIST } from "@/lib/mou/event-lifecycle"
import type { AcademicEventApplication } from "@/lib/mou/types"

// Daily job: approved -> completed once the event has ended (00:00 IST the
// day after its last day — see src/lib/mou/event-lifecycle.ts).
//
// What this deliberately does NOT do: send any email / WhatsApp / calendar
// update, or touch report_status or the report reminder columns. It writes a
// status transition + updated_at + one admin_audit_log row, nothing else.
// That is why it does not call updateApplicationStatus(): that helper is an
// unconditional UPDATE (no compare-and-set) and this job needs
// `where id = ? and status = 'approved'` so it can never overwrite a status an
// admin changed between our SELECT and our UPDATE.

/** Max applications moved per run; the rest are picked up by the next daily run. */
export const MOU_AUTO_COMPLETE_MAX_PER_RUN = 50
export const MOU_AUTO_COMPLETE_ACTOR = "system:mou-auto-complete"

export interface MouAutoCompleteResult {
  completed: number
  skipped: number
  /** Eligible applications beyond the per-run cap, left for the next run. */
  deferred: number
  dryRun: boolean
  completedIds: string[]
  skippedDetails: { applicationId: string; reason: string }[]
}

export async function runMouAutoComplete(
  options: { dryRun?: boolean; now?: Date } = {}
): Promise<MouAutoCompleteResult> {
  const now = options.now ?? new Date()
  const dryRun = options.dryRun === true
  const supabase = createAdminClient()
  const today = todayIST(now)

  // Coarse SQL prefilter on the app's own date columns (cheap, and never
  // *excludes* an eligible row: a linked event's later end_date can only
  // push completion later, and the precise decision is made in JS below).
  const { data, error } = await supabase
    .from("academic_event_applications")
    .select("id, application_type_id, status, finalized_date, preferred_date_1, created_event_id")
    .eq("status", "approved")
    .or(`and(finalized_date.not.is.null,finalized_date.lte.${today}),and(finalized_date.is.null,preferred_date_1.lte.${today})`)
    .order("created_at", { ascending: true })
    .limit(500)
  if (error) throw new Error(`Fetch auto-complete candidates failed: ${error.message}`)
  const candidates = (data ?? []) as Pick<
    AcademicEventApplication,
    "id" | "application_type_id" | "status" | "finalized_date" | "preferred_date_1" | "created_event_id"
  >[]

  // Multi-day events: the linked events row's end_date (when it exists and is
  // later than the application's own date) keeps a course "approved" until
  // its real last day. Read-only.
  const eventIds = candidates.map((c) => c.created_event_id).filter((id): id is string => !!id)
  const endDateByEventId = new Map<string, string | null>()
  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase.from("events").select("id, end_date").in("id", eventIds)
    if (eventsError) throw new Error(`Fetch linked events failed: ${eventsError.message}`)
    for (const e of events ?? []) endDateByEventId.set(e.id as string, (e.end_date as string | null) ?? null)
  }

  const eligible = candidates.filter((c) =>
    shouldAutoComplete(c, now, c.created_event_id ? endDateByEventId.get(c.created_event_id) : null)
  )
  const batch = eligible.slice(0, MOU_AUTO_COMPLETE_MAX_PER_RUN)

  const result: MouAutoCompleteResult = {
    completed: 0,
    skipped: 0,
    deferred: Math.max(0, eligible.length - batch.length),
    dryRun,
    completedIds: [],
    skippedDetails: [],
  }

  for (const app of batch) {
    if (dryRun) {
      result.completedIds.push(app.id)
      continue
    }
    const linkedEnd = app.created_event_id ? endDateByEventId.get(app.created_event_id) : null
    const nowISO = new Date().toISOString()

    // Compare-and-set: matches only while the row is still 'approved'.
    const { data: updated, error: updateError } = await supabase
      .from("academic_event_applications")
      .update({ status: "completed", updated_at: nowISO })
      .eq("id", app.id)
      .eq("status", "approved")
      .select("id")
      .maybeSingle()
    if (updateError) {
      console.error(`[mou-auto-complete] update failed for ${app.id}:`, updateError.message)
      result.skipped++
      result.skippedDetails.push({ applicationId: app.id, reason: "update failed" })
      continue
    }
    if (!updated) {
      result.skipped++
      result.skippedDetails.push({ applicationId: app.id, reason: "status changed since read" })
      continue
    }

    result.completed++
    result.completedIds.push(app.id)
    await logAdminAction({
      adminEmail: MOU_AUTO_COMPLETE_ACTOR,
      adminName: "MOU auto-complete (cron)",
      action: "mou_auto_completed",
      entityType: "academic_event_application",
      entityId: app.id,
      details: {
        changes: { status: { from: "approved", to: "completed" } },
        fieldCount: 1,
        eventDateUsed: eventLastDay(app, linkedEnd),
        dateSource: linkedEnd && linkedEnd > (app.finalized_date ?? app.preferred_date_1) ? "linked_event_end_date" : app.finalized_date ? "finalized_date" : "preferred_date_1",
        endedAtIST: eventEndedAt(app, linkedEnd)?.toISOString(),
        runAt: nowISO,
      },
    })
  }

  return result
}
