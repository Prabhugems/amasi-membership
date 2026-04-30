/**
 * Backfill `step_data.email_verified=true` for 22 abandoned drafts that
 * verified their OTP server-side (`otp_codes.verified=true`) but never had
 * the flag persisted on the draft due to the pre-58f2095 sync race.
 *
 * Background: Phase 1 OTP cohort investigation, 2026-04-30. See BACKLOG.md
 * "Phase 1 OTP investigation follow-ups" and commit 58f2095 for the live-path
 * fix that already shipped (this script handles only the back-catalog).
 *
 * Default mode: --dry-run (no writes).
 * Pass --apply to mutate; the script will require a typed-confirmation phrase.
 *
 * Refusal contract: refuses to run if the candidate count is not exactly 22.
 * Population shift = stop and re-investigate, do not auto-recover.
 *
 * Snapshot precondition: --apply refuses to run unless the snapshot table
 * `backfill_email_verified_2026_04_30_snapshot` already exists. Operator
 * cannot bypass the rollback path.
 *
 * Atomicity: per-row UPDATE is atomic (single statement). Cross-row atomicity
 * is NOT provided by supabase-js — rely on the snapshot table for batch
 * rollback. On first per-row failure the script stops; partial state is
 * bounded and surfaced via the audit-log batch_failed event + the snapshot.
 */
import { createAdminClient } from "../src/lib/supabase"
import { logMembershipAuditEvent } from "../src/lib/audit-log"
import * as readline from "node:readline/promises"
import { stdin, stdout } from "node:process"

// --- Constants ---
const APPLY = process.argv.includes("--apply")
const NOW_ISO = new Date().toISOString()
const BACKFILL_RUN_ID = `phase1-otp-${NOW_ISO.slice(0, 10)}`
const BACKFILL_SOURCE = "phase1-otp-investigation-2026-04-30"
const SNAPSHOT_TABLE = "backfill_email_verified_2026_04_30_snapshot"

// Frozen cohort: the 22 draft UUIDs from 2026-04-30 Step B (excluding the
// +456s OTP-offset outlier ...a72ebedd). The script filters by this list AND
// applies dynamic predicates (formData IS NULL, email_verified != 'true') —
// so naturally-healed drafts drop out cleanly per-run. Today's expected
// dynamic count is 21 (...95a37076 healed organically late on 2026-04-30).
const CANDIDATE_IDS: readonly string[] = [
  "8354153f-45d7-405f-bf1a-084d37ad23f1",
  "b90dd2f9-a24e-4012-8246-3188c1e8997d",
  "80832a6c-deca-4c2c-b89c-6aee2e4bef6e",
  "fd10dc8d-71ea-4be9-b46b-de0740b92290",
  "13c79de5-99ef-4246-be5c-42515cb75870",
  "cd36b5fc-59df-49c1-bf36-80987dc7812c",
  "1c6c0c4a-f7ff-4900-b54b-83bc065f4106",
  "fc80de87-8031-4719-be82-f6c176e154bf",
  "98f68347-741f-4c4a-912d-e21ca8a2fc73",
  "4e216b78-7fff-41cd-ad61-b3a4f9c21d82",
  "776e8bd0-5a6f-4957-8ab5-311762399dd6",
  "2e795ddd-a410-4c7f-a5b5-b7aa944479c4",
  "953d8823-ba36-41b4-ac63-dd6838b4f7b6",
  "6f1ae417-3f1c-48ca-83f5-32e3e3932866",
  "bc47eb6a-e310-45f6-8998-0219c4a2c391",
  "e2db547d-e5d4-4d04-b976-e24653fb419f",
  "5289eedf-14f1-43bb-bf36-a34af3734da1",
  "7fb49e43-512f-49e5-a293-350191c1e40c",
  "97d59f57-115f-4a07-912f-28361b1c7471",
  "dd5f0ed5-1b37-46c9-aa4b-dc2376696293",
  "c18f7953-ccb0-48d4-91e1-d452bcc6313c",
  "600bd8fb-4ca0-4652-afc1-4d9e95a37076",
] as const

// --limit N (optional staged rollout)
const ARG_LIMIT: number | null = (() => {
  const i = process.argv.indexOf("--limit")
  if (i > 0 && i + 1 < process.argv.length) {
    const n = parseInt(process.argv[i + 1], 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  return null
})()

// Time bracket: ±5min around draft.created_at.
// Step B used +10min upper and surfaced one outlier at +456s offset (~7.6min).
// Tightening to +5min encodes the rule, not the row exclusion: an OTP must
// have been created with the draft (sub-second normally) or via a single
// in-flow Resend (still well under 5min). Anything beyond that is a separate
// attempt and we don't backfill it.
const OTP_OFFSET_SEC = 5 * 60

// Skip drafts the user might still be live in.
const LIVE_USER_GUARD_HOURS = 1

// --- Types ---
interface DraftRow {
  id: string
  email: string
  created_at: string
  updated_at: string
  status: string
  current_step: number
  step_data: Record<string, unknown> | null
}

interface OtpRow {
  id: string
  email: string
  verified: boolean | null
  attempts: number | null
  created_at: string | null
}

interface Candidate extends DraftRow {
  matched_otp_id: string
  matched_otp_created_at: string
  offset_sec: number
}

type AdminClient = ReturnType<typeof createAdminClient>

// --- Helpers ---
function log(...a: unknown[]) { console.log("[backfill-email-verified]", ...a) }
function err(...a: unknown[]) { console.error("[backfill-email-verified]", ...a) }
function redactEmail(email: string): string {
  const [local, domain] = email.split("@")
  if (!domain) return "<redacted>"
  return `${local.slice(0, 2)}***@${domain}`
}

async function checkSnapshotTable(
  supabase: AdminClient,
): Promise<{ exists: boolean; rowCount: number | null; probeError?: string }> {
  const { count, error } = await supabase
    .from(SNAPSHOT_TABLE)
    .select("*", { count: "exact", head: true })

  // Debug: print the raw probe shape so future probe failures are diagnosable.
  // PostgREST/supabase-js error shapes vary between versions and table states.
  if (error) {
    const e = error as { code?: string; message?: string; details?: string; hint?: string }
    console.debug(
      `[backfill-email-verified] checkSnapshotTable error: code=${e.code ?? "<none>"} ` +
      `message=${JSON.stringify(e.message ?? "")} details=${JSON.stringify(e.details ?? "")} ` +
      `hint=${JSON.stringify(e.hint ?? "")}`
    )
  } else {
    console.debug(`[backfill-email-verified] checkSnapshotTable ok: count=${count ?? "<null>"}`)
  }

  // Fail-closed contract: exists=true REQUIRES (no error) AND (typeof count === 'number').
  // Empirically (2026-04-30) supabase-js returned {data: null, error: null, count: null}
  // for a missing table; the prior `count ?? 0` coercion turned that into a false
  // "exists with 0 rows" — a safety hole the --apply gate depended on.
  if (!error && typeof count === "number") {
    return { exists: true, rowCount: count }
  }
  if (!error) {
    return { exists: false, rowCount: null, probeError: "count_unknown" }
  }
  return { exists: false, rowCount: null, probeError: (error as { message?: string }).message }
}

// --- Steps ---
async function selectCandidates(supabase: AdminClient): Promise<Candidate[]> {
  const liveCutoff = new Date(Date.now() - LIVE_USER_GUARD_HOURS * 3600 * 1000).toISOString()

  const { data: drafts, error } = await supabase
    .from("draft_applications")
    .select("id, email, created_at, updated_at, status, current_step, step_data")
    .in("id", [...CANDIDATE_IDS])
    .is("deleted_at", null)
    .in("status", ["in_progress", "stuck"])
    .lt("updated_at", liveCutoff)
    .is("step_data->formData", null)
    .order("created_at", { ascending: true })

  if (error) throw new Error(`fetch drafts failed: ${error.message}`)

  const candidates: Candidate[] = []
  for (const d of (drafts || []) as DraftRow[]) {
    const sd = (d.step_data || {}) as Record<string, unknown>
    if (sd.email_verified === true) continue

    const draftCreatedMs = new Date(d.created_at).getTime()
    const lower = new Date(draftCreatedMs - OTP_OFFSET_SEC * 1000).toISOString()
    const upper = new Date(draftCreatedMs + OTP_OFFSET_SEC * 1000).toISOString()

    const { data: otps, error: otpErr } = await supabase
      .from("otp_codes")
      .select("id, email, verified, attempts, created_at")
      .ilike("email", d.email)
      .eq("verified", true)
      .gte("created_at", lower)
      .lte("created_at", upper)
      .order("created_at", { ascending: true })
      .limit(1)

    if (otpErr) throw new Error(`fetch otp for draft ${d.id}: ${otpErr.message}`)
    if (!otps || otps.length === 0) continue

    const otp = otps[0] as OtpRow
    const offsetSec = (new Date(otp.created_at!).getTime() - draftCreatedMs) / 1000
    candidates.push({
      ...d,
      matched_otp_id: otp.id,
      matched_otp_created_at: otp.created_at!,
      offset_sec: offsetSec,
    })
  }
  return candidates
}

function printCandidates(candidates: Candidate[]) {
  log(`candidates: ${candidates.length}`)
  log("─".repeat(96))
  log(" #  | draft_id_tail | age_d | offset_s | otp_id_tail   | email_redacted")
  log("─".repeat(96))
  candidates.forEach((c, i) => {
    const tail = c.id.slice(-8)
    const ageD = ((Date.now() - new Date(c.created_at).getTime()) / 86400000).toFixed(1)
    const otpTail = c.matched_otp_id.slice(-8)
    log(
      `${String(i + 1).padStart(2)}  | ...${tail} | ${ageD.padStart(5)} | ` +
      `${c.offset_sec.toFixed(2).padStart(8)} | ...${otpTail} | ${redactEmail(c.email)}`
    )
  })
  log("─".repeat(96))
}

async function confirmApply(count: number): Promise<boolean> {
  const phrase = `BACKFILL ${count} ROWS`
  const rl = readline.createInterface({ input: stdin, output: stdout })
  log("")
  log(`This will UPDATE ${count} draft_applications rows.`)
  log(`Type the EXACT phrase to proceed (anything else aborts):`)
  log(`  ${phrase}`)
  const answer = (await rl.question("> ")).trim()
  rl.close()
  return answer === phrase
}

async function applyOne(supabase: AdminClient, c: Candidate) {
  const merged = {
    ...(c.step_data || {}),
    email_verified: true,
    email_verified_backfilled: true,
    email_verified_backfilled_at: NOW_ISO,
  }
  // Re-check predicates at write time so any user verifying mid-run drops out.
  const { data, error } = await supabase
    .from("draft_applications")
    .update({ step_data: merged, updated_at: NOW_ISO })
    .eq("id", c.id)
    .is("deleted_at", null)
    .in("status", ["in_progress", "stuck"])
    .is("step_data->formData", null)
    .select("id")
    .maybeSingle()
  if (error) throw new Error(`update ${c.id}: ${error.message}`)
  return data
}

async function main() {
  log(`run started: APPLY=${APPLY}, run_id=${BACKFILL_RUN_ID}${ARG_LIMIT ? `, limit=${ARG_LIMIT}` : ""}`)
  const supabase = createAdminClient()

  // --- Precondition: snapshot table must exist when --apply is set ---
  const snap = await checkSnapshotTable(supabase)
  if (APPLY && !snap.exists) {
    err(`REFUSING TO RUN --apply: snapshot table ${SNAPSHOT_TABLE} does not exist.`)
    err(`Create snapshot before running --apply:`)
    err(`  CREATE TABLE ${SNAPSHOT_TABLE} AS`)
    err(`  SELECT id, step_data FROM draft_applications WHERE id IN (<candidate-ids>);`)
    if (snap.probeError) err(`(probe error: ${snap.probeError})`)
    process.exit(4)
  }
  if (!APPLY && !snap.exists) {
    log(`Note: snapshot table ${SNAPSHOT_TABLE} not found — required for --apply. Proceeding with dry-run.`)
  }
  if (snap.exists) {
    log(`snapshot table ${SNAPSHOT_TABLE} present (rows: ${snap.rowCount ?? "?"})`)
  }

  log("identifying candidates...")
  let candidates = await selectCandidates(supabase)

  if (candidates.length > CANDIDATE_IDS.length) {
    err(`REFUSING TO RUN: got ${candidates.length} candidates, expected at most ${CANDIDATE_IDS.length}.`)
    err(`Impossible — IDs are filtered against a frozen list of ${CANDIDATE_IDS.length}. Investigate immediately.`)
    process.exit(1)
  }
  if (candidates.length < CANDIDATE_IDS.length) {
    const matchedIds = new Set(candidates.map((c) => c.id))
    const healedIds = CANDIDATE_IDS.filter((id) => !matchedIds.has(id))
    log("")
    log(`NOTICE: ${healedIds.length} draft(s) from the frozen cohort dropped out of the candidate set.`)
    log(`Most likely naturally healed (user verified between 2026-04-30 dry-run and now). No action needed.`)
    log(`Excluded from this run:`)
    for (const id of healedIds) log(`  ...${id.slice(-8)}  (full: ${id})`)
    log(`Effective backfill count: ${candidates.length}`)
    log("")
  }

  printCandidates(candidates)

  if (ARG_LIMIT) {
    log("")
    log(`--limit ${ARG_LIMIT}: would process the first ${ARG_LIMIT} of ${candidates.length} rows`)
    candidates = candidates.slice(0, ARG_LIMIT)
  }

  if (!APPLY) {
    log("")
    log("DRY-RUN — no rows mutated. Pass --apply to execute.")
    process.exit(0)
  }

  const ok = await confirmApply(candidates.length)
  if (!ok) {
    err("confirmation declined. exiting without changes.")
    process.exit(2)
  }

  log("")
  log("applying...")

  await logMembershipAuditEvent({
    action: "draft_email_verified_backfill_started",
    entityType: "draft_application",
    entityId: `batch_${BACKFILL_RUN_ID}`,
    newData: {
      run_id: BACKFILL_RUN_ID,
      source: BACKFILL_SOURCE,
      candidate_count: candidates.length,
    },
    performedBy: "system",
  }, supabase)

  let succeeded = 0
  const skipped: { id: string; reason: string }[] = []

  for (const c of candidates) {
    try {
      const result = await applyOne(supabase, c)
      if (!result) {
        skipped.push({ id: c.id, reason: "predicate failed at write time (likely user verified concurrently)" })
        log(`  ~ ...${c.id.slice(-8)}  skipped (race)`)
        continue
      }
      await logMembershipAuditEvent({
        action: "draft_email_verified_backfilled",
        entityType: "draft_application",
        entityId: c.id,
        newData: {
          matched_otp_id: c.matched_otp_id,
          otp_created_at: c.matched_otp_created_at,
          offset_sec: c.offset_sec,
          run_id: BACKFILL_RUN_ID,
          source: BACKFILL_SOURCE,
        },
        performedBy: "system",
      }, supabase)
      succeeded++
      log(`  ✓ ...${c.id.slice(-8)}  (${succeeded}/${candidates.length})`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      err(`  ✗ ...${c.id.slice(-8)}: ${msg}`)
      err(`STOPPING. ${succeeded} updated, ${skipped.length} skipped, ${candidates.length - succeeded - skipped.length} not yet attempted.`)
      err(`Snapshot table ${SNAPSHOT_TABLE} is the rollback path.`)
      await logMembershipAuditEvent({
        action: "draft_email_verified_backfill_failed",
        entityType: "draft_application",
        entityId: `batch_${BACKFILL_RUN_ID}`,
        newData: {
          run_id: BACKFILL_RUN_ID,
          source: BACKFILL_SOURCE,
          succeeded,
          skipped: skipped.length,
          remaining: candidates.length - succeeded - skipped.length,
          failed_on_id: c.id,
          error: msg,
        },
        performedBy: "system",
      }, supabase)
      process.exit(3)
    }
  }

  await logMembershipAuditEvent({
    action: "draft_email_verified_backfill_completed",
    entityType: "draft_application",
    entityId: `batch_${BACKFILL_RUN_ID}`,
    newData: {
      run_id: BACKFILL_RUN_ID,
      source: BACKFILL_SOURCE,
      succeeded,
      skipped: skipped.length,
      skipped_details: skipped,
    },
    performedBy: "system",
  }, supabase)

  log("")
  log(`DONE: ${succeeded} updated, ${skipped.length} skipped (race-loss), 0 failed`)
  process.exit(0)
}

main().catch((e) => {
  err("fatal:", e instanceof Error ? e.message : e)
  process.exit(1)
})
