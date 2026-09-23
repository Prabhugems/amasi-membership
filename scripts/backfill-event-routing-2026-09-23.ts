/**
 * Backfill event_routing for existing academic_event_applications rows
 * (sql/049 added the column nullable, on purpose — pre-existing rows never
 * had a value), and report any already-approved application whose linked
 * event's tenant/created_by don't match what routing now implies.
 *
 * Unlike scripts/backfill-email-verified-2026-04-30.ts, no snapshot table
 * is needed here: every value this script writes is re-derivable at any
 * time from academic_event_types.default_event_routing (step 1) or from
 * the application's own event_routing + application_type_id (step 2) — a
 * bad run can simply be re-run, not "recovered from a snapshot."
 *
 * Default mode: --dry-run (no writes). Pass --apply to mutate; requires a
 * typed-confirmation phrase, matching this repo's backfill convention.
 */
import { createAdminClient } from "../src/lib/supabase"
import { logAdminAction } from "../src/lib/audit-log"
import * as readline from "node:readline/promises"
import { stdin, stdout } from "node:process"

const APPLY = process.argv.includes("--apply")
const NOW_ISO = new Date().toISOString()

function log(...a: unknown[]) { console.log("[backfill-event-routing]", ...a) }
function err(...a: unknown[]) { console.error("[backfill-event-routing]", ...a) }

type AdminClient = ReturnType<typeof createAdminClient>
type Routing = "amasi" | "college" | "none"

interface RoutingGap {
  id: string
  application_type_id: string
  organizer_name: string
  routing: Routing
}

interface TenantMismatch {
  applicationId: string
  eventId: string
  organizerName: string
  expectedTenant: "amasi" | "college"
  actualTenant: string | null
  createdByNull: boolean
}

// Step 1: applications with event_routing still null.
async function findRoutingGaps(supabase: AdminClient): Promise<RoutingGap[]> {
  const [{ data: apps, error: appsError }, { data: types, error: typesError }] = await Promise.all([
    supabase
      .from("academic_event_applications")
      .select("id, application_type_id, organizer_name")
      .is("event_routing", null),
    supabase.from("academic_event_types").select("id, default_event_routing"),
  ])
  if (appsError) throw new Error(`fetch applications failed: ${appsError.message}`)
  if (typesError) throw new Error(`fetch types failed: ${typesError.message}`)

  const routingByType = new Map<string, Routing>((types ?? []).map((t) => [t.id, t.default_event_routing as Routing]))
  return (apps ?? []).map((a) => ({
    id: a.id,
    application_type_id: a.application_type_id,
    organizer_name: a.organizer_name,
    routing: routingByType.get(a.application_type_id) ?? "amasi",
  }))
}

// Step 2: approved/completed applications whose linked event's tenant/created_by
// don't match what event_routing now implies. Reads only — reported, not
// auto-fixed, since a real mismatch this late is worth a human look rather
// than a silent overwrite.
async function findTenantMismatches(supabase: AdminClient): Promise<TenantMismatch[]> {
  const { data: apps, error } = await supabase
    .from("academic_event_applications")
    .select("id, organizer_name, event_routing, created_event_id, status")
    .in("status", ["approved", "completed"])
    .not("created_event_id", "is", null)
  if (error) throw new Error(`fetch approved applications failed: ${error.message}`)

  const mismatches: TenantMismatch[] = []
  for (const a of apps ?? []) {
    const routing = a.event_routing as Routing | null
    if (!routing || routing === "none") continue // 'none' with an existing event is its own anomaly, not this script's job
    const { data: eventRow } = await supabase
      .from("events")
      .select("tenant, created_by")
      .eq("id", a.created_event_id)
      .maybeSingle()
    if (!eventRow) continue
    if (eventRow.tenant !== routing || !eventRow.created_by) {
      mismatches.push({
        applicationId: a.id,
        eventId: a.created_event_id as string,
        organizerName: a.organizer_name,
        expectedTenant: routing,
        actualTenant: eventRow.tenant,
        createdByNull: !eventRow.created_by,
      })
    }
  }
  return mismatches
}

async function confirmApply(count: number): Promise<boolean> {
  const phrase = `BACKFILL ${count} ROWS`
  const rl = readline.createInterface({ input: stdin, output: stdout })
  log("")
  log(`This will UPDATE ${count} academic_event_applications rows.`)
  log(`Type the EXACT phrase to proceed (anything else aborts):`)
  log(`  ${phrase}`)
  const answer = (await rl.question("> ")).trim()
  rl.close()
  return answer === phrase
}

async function main() {
  log(`run started: APPLY=${APPLY}`)
  const supabase = createAdminClient()

  log("checking for applications with no event_routing set...")
  const gaps = await findRoutingGaps(supabase)
  log(`found ${gaps.length} application(s) needing event_routing backfilled`)
  if (gaps.length > 0) {
    log("─".repeat(80))
    for (const g of gaps) log(`  ${g.id}  ${g.application_type_id.padEnd(16)} -> ${g.routing.padEnd(8)}  (${g.organizer_name})`)
    log("─".repeat(80))
  }

  log("")
  log("checking already-approved applications for tenant/created_by mismatches against their event...")
  const mismatches = await findTenantMismatches(supabase)
  log(`found ${mismatches.length} mismatch(es)`)
  if (mismatches.length > 0) {
    log("─".repeat(96))
    for (const m of mismatches) {
      log(
        `  application ${m.applicationId} / event ${m.eventId} (${m.organizerName}): ` +
        `tenant is '${m.actualTenant}', expected '${m.expectedTenant}'` +
        (m.createdByNull ? "; created_by is null" : "")
      )
    }
    log("─".repeat(96))
    log("NOTE: these are reported only, not auto-fixed — use the admin routing selector")
    log("(PATCH /api/admin/mou-applications/[id]/routing) to correct each one deliberately.")
  }

  if (!APPLY) {
    log("")
    log(`DRY-RUN — no rows mutated. ${gaps.length} event_routing value(s) would be set. Pass --apply to execute.`)
    process.exit(0)
  }

  if (gaps.length === 0) {
    log("")
    log("Nothing to apply — no event_routing gaps found.")
    process.exit(0)
  }

  const ok = await confirmApply(gaps.length)
  if (!ok) {
    err("confirmation declined. exiting without changes.")
    process.exit(2)
  }

  log("")
  log("applying...")
  let succeeded = 0
  for (const g of gaps) {
    try {
      const { error } = await supabase
        .from("academic_event_applications")
        .update({ event_routing: g.routing, updated_at: NOW_ISO })
        .eq("id", g.id)
        .is("event_routing", null) // re-check at write time — an admin may have set it manually mid-run
      if (error) throw new Error(error.message)
      await logAdminAction({
        adminEmail: "system@amasi.org",
        action: "mou_event_routing_backfilled",
        entityType: "academic_event_application",
        entityId: g.id,
        details: { event_routing: g.routing, application_type_id: g.application_type_id },
      })
      succeeded++
      log(`  ✓ ${g.id}  (${succeeded}/${gaps.length})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      err(`  ✗ ${g.id}: ${msg}`)
      err(`STOPPING. ${succeeded} updated, ${gaps.length - succeeded} not yet attempted. Re-run to continue — no snapshot needed.`)
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
