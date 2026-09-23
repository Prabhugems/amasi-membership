import { createAdminClient } from "@/lib/supabase"
import { getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { createApprovalToken } from "@/lib/mou/approval-token"
import { sendReportReminderEmail, sendReportEscalationEmail } from "@/lib/mou/notify"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { DIRECTOR_ROLE_BY_APPLICATION_TYPE } from "@/lib/mou/director-roles"
import type { AcademicEventApplication } from "@/lib/mou/types"

// Cadence, all measured from the event date (finalized_date, falling back
// to preferred_date_1 — same fallback decide/route.ts uses when
// auto-creating the calendar event): a heads-up nudge at day 7, the
// deadline-day nudge at day 15 (the MOU's own "within 15 days" clause),
// and — if still nothing filed — a one-time escalation to the Hon.
// Secretary and relevant National Director, sent once past day 15.
export const REPORT_REMINDER_DAY_7 = 7
export const REPORT_DUE_DAYS = 15

export interface MouReportReminderResult {
  reminder7Sent: number
  reminder15Sent: number
  escalationsSent: number
  skipped: number
  skippedDetails: { applicationId: string; stage: string; reason: string }[]
}

function eventDateCutoff(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// Statuses that mean "this application was never approved, or the outcome
// was explicitly negative" — never carries a report obligation. Everything
// else (approved, completed, and any future post-approval status this list
// hasn't been updated for) is included by default. Was previously an
// allowlist (["approved","completed"]) — switched to this denylist 2026-09-23
// after a live check: two completed applications were correctly picked up
// by findCandidates (that allowlist DID include "completed" already, and
// the date math was already correct — the actual bug was that the cron had
// never executed for real in production, unrelated to this filter), but an
// allowlist here is still the same "silently excludes a status nobody
// thought to add" risk this codebase has been burned by before (see
// AGENTS.md's PUBLIC_API_ROUTES allowlist history). "approved at any
// point" is a denylist by nature — flip it to match.
const REPORT_OBLIGATION_EXCLUDED_STATUSES = ["submitted", "under_review", "changes_requested", "rejected"]

// Applications whose event date (finalized_date, falling back to
// preferred_date_1) is on or before `cutoff`, with `column` still unset —
// the shared shape all three stages below query.
async function findCandidates(
  cutoff: string,
  column: "report_reminder_7_sent_at" | "report_reminder_15_sent_at" | "report_escalation_sent_at"
): Promise<AcademicEventApplication[]> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("academic_event_applications")
    .select("*")
    .not("status", "in", `(${REPORT_OBLIGATION_EXCLUDED_STATUSES.join(",")})`)
    .is("report_submitted_at", null)
    .is(column, null)
    .or(`and(finalized_date.not.is.null,finalized_date.lte.${cutoff}),and(finalized_date.is.null,preferred_date_1.lte.${cutoff})`)

  if (error) throw new Error(`Fetch candidates (${column}) failed: ${error.message}`)
  return (data ?? []) as AcademicEventApplication[]
}

// Atomic claim before sending — a conditional update that only matches if
// no other run (cron overlap, or a manual admin trigger) already claimed
// this row for this stage. Same idiom as src/lib/bulk-draft-reminders.ts.
async function claim(
  applicationId: string,
  column: "report_reminder_7_sent_at" | "report_reminder_15_sent_at" | "report_escalation_sent_at"
): Promise<boolean> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from("academic_event_applications")
    .update({ [column]: new Date().toISOString() })
    .eq("id", applicationId)
    .is(column, null)
    .select("id")
    .maybeSingle()
  return !!data
}

export async function runMouReportReminders(options: { dryRun?: boolean } = {}): Promise<MouReportReminderResult> {
  let reminder7Sent = 0
  let reminder15Sent = 0
  let escalationsSent = 0
  const skipped: { applicationId: string; stage: string; reason: string }[] = []

  // Stage 1: day-7 heads-up to the applicant.
  for (const application of await findCandidates(eventDateCutoff(REPORT_REMINDER_DAY_7), "report_reminder_7_sent_at")) {
    if (options.dryRun) {
      skipped.push({ applicationId: application.id, stage: "day7", reason: "dry run" })
      continue
    }
    if (!(await claim(application.id, "report_reminder_7_sent_at"))) {
      skipped.push({ applicationId: application.id, stage: "day7", reason: "claim lost" })
      continue
    }
    const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
    try {
      await sendReportReminderEmail(application, typeLabel, "day7")
      reminder7Sent++
    } catch (err) {
      console.error(`[mou-report-reminders] day7 send failed for ${application.id}:`, err)
      skipped.push({ applicationId: application.id, stage: "day7", reason: "email send failed (claim already recorded)" })
    }
  }

  // Stage 2: day-15 deadline-day nudge to the applicant.
  for (const application of await findCandidates(eventDateCutoff(REPORT_DUE_DAYS), "report_reminder_15_sent_at")) {
    if (options.dryRun) {
      skipped.push({ applicationId: application.id, stage: "day15", reason: "dry run" })
      continue
    }
    if (!(await claim(application.id, "report_reminder_15_sent_at"))) {
      skipped.push({ applicationId: application.id, stage: "day15", reason: "claim lost" })
      continue
    }
    const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
    try {
      await sendReportReminderEmail(application, typeLabel, "day15")
      reminder15Sent++
    } catch (err) {
      console.error(`[mou-report-reminders] day15 send failed for ${application.id}:`, err)
      skipped.push({ applicationId: application.id, stage: "day15", reason: "email send failed (claim already recorded)" })
    }
  }

  // Stage 3: escalation to Hon. Secretary + relevant National Director,
  // once past the day-15 deadline with still nothing filed. Only fires for
  // application types with a matching director (fmas/nextgen/slcp) plus
  // the Secretary always — same DIRECTOR_ROLE_BY_APPLICATION_TYPE map
  // submission-time FYIs use, so the two stay in sync.
  for (const application of await findCandidates(eventDateCutoff(REPORT_DUE_DAYS), "report_escalation_sent_at")) {
    if (options.dryRun) {
      skipped.push({ applicationId: application.id, stage: "escalation", reason: "dry run" })
      continue
    }
    if (!(await claim(application.id, "report_escalation_sent_at"))) {
      skipped.push({ applicationId: application.id, stage: "escalation", reason: "claim lost" })
      continue
    }
    const typeLabel = getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id
    const recipients: { role: string }[] = [{ role: "hon_secretary" }]
    const directorRole = DIRECTOR_ROLE_BY_APPLICATION_TYPE[application.application_type_id]
    if (directorRole) recipients.push({ role: directorRole })

    let anySent = false
    for (const { role } of recipients) {
      try {
        const assignment = await getRoleAssignment(role)
        if (!assignment) continue
        const token = await createApprovalToken(application.id, role, false)
        const viewUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"}/mou/review/${token}`
        await sendReportEscalationEmail(application, typeLabel, assignment.email, role, viewUrl)
        anySent = true
      } catch (err) {
        console.error(`[mou-report-reminders] escalation (${role}) send failed for ${application.id}:`, err)
        skipped.push({ applicationId: application.id, stage: `escalation:${role}`, reason: "email send failed" })
      }
    }
    if (anySent) escalationsSent++
  }

  return { reminder7Sent, reminder15Sent, escalationsSent, skipped: skipped.length, skippedDetails: skipped }
}
