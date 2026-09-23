/**
 * Backfill missing organiser/director team_invitations rows on MOU-created
 * events — 3 of 9 MOU-created events had none (mou-fixes-prompt.md #3),
 * from approvals that predate the event-routing feature's invite step in
 * decide/route.ts. 2 of the 3 are non-issues once issue #1 (blood donation
 * camp gets cancelled) and the e2e test cleanup are accounted for; this
 * targets whatever real gap remains at run time, not a hardcoded row.
 *
 * Idempotent by construction: the team_invitations existence check
 * (event_ids contains the event id, for that email) IS the guard — safe to
 * re-run, never sends a duplicate invite or email.
 *
 * Default mode: --dry-run (no writes, no emails). Pass --apply to send.
 * No snapshot table needed (same reasoning as
 * scripts/backfill-event-routing-2026-09-23.ts) — every value here is
 * re-derivable from the application + event rows at any time.
 */
import { createAdminClient } from "../src/lib/supabase"
import { getRoleAssignment } from "../src/lib/mou/supabase-helpers"
import { DIRECTOR_ROLE_BY_APPLICATION_TYPE } from "../src/lib/mou/director-roles"
import { sendOutcomeEmail } from "../src/lib/mou/notify"
import type { AcademicEventApplication } from "../src/lib/mou/types"

// Deliberately NOT importing getEventTypeConfig from event-type-config.ts —
// it re-exports the MOU clause constants from mou-pdf.tsx, which pulls in
// @react-pdf/renderer's ESM graph. That fails to resolve under tsx's loader
// in this environment (ERR_PACKAGE_PATH_NOT_EXPORTED on
// @react-pdf/hyphenate), unrelated to this script's logic. A direct read of
// academic_event_types.label is the same source of truth without the
// dependency.
async function getTypeLabel(supabase: ReturnType<typeof createAdminClient>, applicationTypeId: string): Promise<string> {
  const { data } = await supabase.from("academic_event_types").select("label").eq("id", applicationTypeId).maybeSingle()
  return data?.label ?? applicationTypeId
}

const APPLY = process.argv.includes("--apply")

function log(...a: unknown[]) { console.log("[backfill-mou-event-invites]", ...a) }
function err(...a: unknown[]) { console.error("[backfill-mou-event-invites]", ...a) }

interface Target {
  application: AcademicEventApplication
  eventId: string
  eventName: string
  eventStartDate: string | null
}

async function findTargets(supabase: ReturnType<typeof createAdminClient>): Promise<Target[]> {
  const { data: apps, error } = await supabase
    .from("academic_event_applications")
    .select("*")
    .in("status", ["approved", "completed"])
    .not("event_routing", "eq", "none")
    .not("created_event_id", "is", null)
  if (error) throw new Error(`fetch applications failed: ${error.message}`)

  const targets: Target[] = []
  for (const application of (apps ?? []) as AcademicEventApplication[]) {
    const eventId = application.created_event_id as string
    const { data: eventRow } = await supabase
      .from("events")
      .select("id, name, status, start_date")
      .eq("id", eventId)
      .maybeSingle()
    if (!eventRow || eventRow.status === "cancelled") continue // cancelled events don't need a fresh organiser invite

    const { data: existingInvite } = await supabase
      .from("team_invitations")
      .select("id")
      .eq("email", application.email)
      .contains("event_ids", [eventId])
      .maybeSingle()
    if (existingInvite) continue

    targets.push({ application, eventId, eventName: eventRow.name, eventStartDate: eventRow.start_date })
  }
  return targets
}

async function main() {
  log(`run started: APPLY=${APPLY}`)
  const supabase = createAdminClient()

  const targets = await findTargets(supabase)
  log(`found ${targets.length} application(s) missing an organiser invite on their MOU-created event`)
  if (targets.length === 0) {
    log("Nothing to do.")
    process.exit(0)
  }

  log("─".repeat(96))
  for (const t of targets) {
    const directorRole = DIRECTOR_ROLE_BY_APPLICATION_TYPE[t.application.application_type_id]
    log(
      `  ${t.application.id}  ${t.application.application_type_id.padEnd(14)} ${t.application.organizer_name.padEnd(30)} ` +
      `-> event ${t.eventId} "${t.eventName}"` +
      (directorRole ? ` (+ director role: ${directorRole})` : "")
    )
  }
  log("─".repeat(96))

  if (!APPLY) {
    log("")
    log(`DRY-RUN — no invites sent, no emails sent. Pass --apply to send ${targets.length} organiser invite(s).`)
    process.exit(0)
  }

  let succeeded = 0
  for (const t of targets) {
    const { application, eventId, eventName, eventStartDate } = t
    try {
      await supabase.from("team_invitations").insert({
        email: application.email,
        name: application.organizer_name,
        role: "coordinator",
        event_ids: [eventId],
      })
    } catch (e) {
      err(`  ✗ organiser invite failed for ${application.id}:`, e instanceof Error ? e.message : e)
      continue
    }

    // Unlike decide/route.ts and retry-event/route.ts (which only ever run
    // against a brand-new eventId that can't already have invitations),
    // this script targets EXISTING events — some of which already have the
    // director invited (just not the organiser, the actual gap being
    // fixed). Must check before inserting, or it duplicates the director's
    // row. Confirmed against live data: Roy Patankar/Jayanta Kumar Das
    // already had a consolidated multi-event invite for 5 of these 6
    // targets; an unconditional insert created a redundant single-event
    // row for each, cleaned up manually after the first --apply run.
    const directorRole = DIRECTOR_ROLE_BY_APPLICATION_TYPE[application.application_type_id]
    if (directorRole) {
      try {
        const director = await getRoleAssignment(directorRole)
        if (director) {
          const { data: existingDirectorInvite } = await supabase
            .from("team_invitations")
            .select("id")
            .eq("email", director.email)
            .contains("event_ids", [eventId])
            .maybeSingle()
          if (!existingDirectorInvite) {
            await supabase.from("team_invitations").insert({
              email: director.email,
              name: director.name,
              role: "coordinator",
              event_ids: [eventId],
            })
          }
        }
      } catch (e) {
        err(`  director invite failed for ${application.id} (non-fatal):`, e instanceof Error ? e.message : e)
      }
    }

    const typeLabel = await getTypeLabel(supabase, application.application_type_id)
    try {
      // Reuses the exact same "approved" outcome email new approvals get
      // (decide/route.ts), minus the MOU PDF re-attachment — that was
      // already sent at the original approval; this backfill is only
      // correcting the missed invite step.
      await sendOutcomeEmail(application, typeLabel, "approved", null, undefined, {
        name: eventName,
        startDate: eventStartDate,
        eventsUrl: `https://events.amasi.org/events/${eventId}`,
      })
    } catch (e) {
      err(`  event-details email failed for ${application.id} (invite still sent):`, e instanceof Error ? e.message : e)
    }

    succeeded++
    log(`  ✓ ${application.id}  (${succeeded}/${targets.length})`)
  }

  log("")
  log(`DONE: ${succeeded}/${targets.length} succeeded`)
  process.exit(succeeded === targets.length ? 0 : 1)
}

main().catch((e) => {
  err("fatal:", e instanceof Error ? e.message : e)
  process.exit(1)
})
