/**
 * Dry-run rename for existing MOU-created events (events list page fix,
 * item 5). createEventForApplication() (src/lib/mou/event-routing.ts) now
 * writes a distinctive short_name ("<event_name or type label> — <city,
 * state>") and the new organizer_name column on every fresh approval —
 * this backfills the same values onto events created before that change,
 * so the events.amasi.org card shows a real title instead of the bare,
 * identical-across-every-course type label ("FMAS Course").
 *
 * Default mode: --dry-run (no writes). Pass --apply to mutate; requires a
 * typed-confirmation phrase, matching this repo's backfill convention
 * (scripts/backfill-event-routing-2026-09-23.ts).
 */
import { createAdminClient } from "../src/lib/supabase"
import { logAdminAction } from "../src/lib/audit-log"
import * as readline from "node:readline/promises"
import { stdin, stdout } from "node:process"

const APPLY = process.argv.includes("--apply")

function log(...a: unknown[]) { console.log("[rename-mou-events]", ...a) }
function err(...a: unknown[]) { console.error("[rename-mou-events]", ...a) }

type AdminClient = ReturnType<typeof createAdminClient>

interface RenameTarget {
  applicationId: string
  eventId: string
  oldShortName: string | null
  newShortName: string
  oldOrganizerName: string | null
  newOrganizerName: string
  shortNameSkippedReason?: string
}

// Deliberately not importing getEventTypeConfig from event-type-config.ts —
// it re-exports the MOU clause constants from mou-pdf.tsx, which pulls in
// @react-pdf/renderer's ESM graph and fails to resolve under tsx's loader
// in this environment. A direct read of academic_event_types.label is the
// same source of truth without the dependency (same workaround as the
// invite-backfill script).
async function getTypeLabel(supabase: AdminClient, applicationTypeId: string): Promise<string> {
  const { data } = await supabase.from("academic_event_types").select("label").eq("id", applicationTypeId).maybeSingle()
  return data?.label ?? applicationTypeId
}

// Mirrors buildEventShortName() in src/lib/mou/event-routing.ts exactly —
// kept in sync by hand since this script intentionally avoids importing
// app internals (see getTypeLabel above); if that function's formula ever
// changes, update this too.
function buildShortName(eventName: string | null, typeLabel: string, city: string | null, state: string | null): string {
  const base = eventName || typeLabel
  const location = city ? `${city}${state ? `, ${state}` : ""}` : null
  return location ? `${base} — ${location}` : base
}

async function findTargets(supabase: AdminClient): Promise<RenameTarget[]> {
  const { data: apps, error } = await supabase
    .from("academic_event_applications")
    .select("id, application_type_id, event_name, venue_city, venue_state, organizer_name, created_event_id")
    .not("created_event_id", "is", null)
  if (error) throw new Error(`fetch applications failed: ${error.message}`)

  const targets: RenameTarget[] = []
  for (const app of apps ?? []) {
    const eventId = app.created_event_id as string
    const { data: eventRow } = await supabase
      .from("events")
      .select("id, short_name, organizer_name, status")
      .eq("id", eventId)
      .maybeSingle()
    if (!eventRow || eventRow.status === "cancelled") continue // don't bother renaming a cancelled event

    const typeLabel = await getTypeLabel(supabase, app.application_type_id)
    const computedShortName = buildShortName(app.event_name, typeLabel, app.venue_city, app.venue_state)
    const newOrganizerName = app.organizer_name

    // application.event_name is blank for some pre-existing rows, which makes
    // buildShortName() fall back to the bare type label ("FMAS Course",
    // "NextGen Organizer") — identical to the flat-title bug this backfill
    // exists to fix. If the event's CURRENT short_name already has something
    // more specific than that bare label (typically a course/batch number
    // set by an earlier, different code path), renaming would regress it.
    // Skip the short_name change for those rows; still update organizer_name,
    // which is purely additive (null -> a real value) and never regresses.
    const eventNameBlank = !app.event_name
    const oldHasExtraInfo = !!eventRow.short_name && eventRow.short_name !== typeLabel
    const wouldRegress = eventNameBlank && oldHasExtraInfo
    const newShortName = wouldRegress ? (eventRow.short_name as string) : computedShortName

    const shortNameChanged = !wouldRegress && eventRow.short_name !== newShortName
    const organizerNameChanged = eventRow.organizer_name !== newOrganizerName
    if (!shortNameChanged && !organizerNameChanged) continue

    targets.push({
      applicationId: app.id,
      eventId,
      oldShortName: eventRow.short_name,
      newShortName,
      oldOrganizerName: eventRow.organizer_name,
      newOrganizerName,
      shortNameSkippedReason: wouldRegress
        ? `skipped: event_name is blank, current short_name "${eventRow.short_name}" is more specific than the computed fallback "${computedShortName}"`
        : undefined,
    })
  }
  return targets
}

async function confirmApply(count: number): Promise<boolean> {
  const phrase = `RENAME ${count} EVENTS`
  const rl = readline.createInterface({ input: stdin, output: stdout })
  log("")
  log(`This will UPDATE ${count} events rows (short_name, organizer_name).`)
  log(`Type the EXACT phrase to proceed (anything else aborts):`)
  log(`  ${phrase}`)
  const answer = (await rl.question("> ")).trim()
  rl.close()
  return answer === phrase
}

async function main() {
  log(`run started: APPLY=${APPLY}`)
  const supabase = createAdminClient()

  const targets = await findTargets(supabase)
  log(`found ${targets.length} event(s) needing a rename`)
  if (targets.length === 0) {
    log("Nothing to do.")
    process.exit(0)
  }

  log("─".repeat(100))
  for (const t of targets) {
    log(`  application ${t.applicationId} / event ${t.eventId}`)
    if (t.shortNameSkippedReason) {
      log(`    short_name:      unchanged — ${t.shortNameSkippedReason}`)
    } else {
      log(`    short_name:      "${t.oldShortName ?? "(null)"}" → "${t.newShortName}"`)
    }
    log(`    organizer_name:  "${t.oldOrganizerName ?? "(null)"}" → "${t.newOrganizerName}"`)
  }
  log("─".repeat(100))

  if (!APPLY) {
    log("")
    log(`DRY-RUN — no rows mutated. Pass --apply to rename ${targets.length} event(s).`)
    process.exit(0)
  }

  const ok = await confirmApply(targets.length)
  if (!ok) {
    err("confirmation declined. exiting without changes.")
    process.exit(2)
  }

  log("")
  log("applying...")
  let succeeded = 0
  for (const t of targets) {
    try {
      const { error } = await supabase
        .from("events")
        .update({ short_name: t.newShortName, organizer_name: t.newOrganizerName, updated_at: new Date().toISOString() })
        .eq("id", t.eventId)
      if (error) throw new Error(error.message)
      const changes: Record<string, { from: string | null; to: string }> = {
        organizer_name: { from: t.oldOrganizerName, to: t.newOrganizerName },
      }
      if (!t.shortNameSkippedReason) {
        changes.short_name = { from: t.oldShortName, to: t.newShortName }
      }
      await logAdminAction({
        adminEmail: "system@amasi.org",
        action: "mou_event_renamed",
        entityType: "event",
        entityId: t.eventId,
        details: { changes, fieldCount: Object.keys(changes).length },
      })
      succeeded++
      log(`  ✓ event ${t.eventId}  (${succeeded}/${targets.length})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      err(`  ✗ event ${t.eventId}: ${msg}`)
      err(`STOPPING. ${succeeded} updated, ${targets.length - succeeded} not yet attempted. Re-run to continue.`)
      process.exit(3)
    }
  }

  log("")
  log(`DONE: ${succeeded} updated, 0 failed`)
  process.exit(0)
}

main().catch((e) => {
  err("fatal:", e instanceof Error ? e.message : e)
  process.exit(1)
})
