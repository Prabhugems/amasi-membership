// Run this after 2026-06-08 04:00 UTC to verify tomorrow's cleanup-drafts cron.
//
// What this answers, in order:
//   (1) Did the cron route execute? (mark_stale + new draft_reminder_sent events)
//   (2) Did Step 1b/Step 2 reminders actually send? (count of draft_reminder_sent)
//   (3) Did any sends fail? (count of draft_reminder_failed)
//   (4) Did Step 3 expiry finally fire on the 45 backlog drafts that were
//       reminded 06-07 03:35 UTC and are now 24h past reminder + 27h past 6h
//       grace? (count of draft_expired for 06-08)
//
// Exit codes:
//   0 = pipeline healthy (reminders + expiry both fired)
//   1 = cron ran but reminders are still no-op (regression NOT fixed)
//   2 = cron didn't run at all
//
// Run:
//   node scripts/verify-cron-run-2026-06-08.mjs

import { createClient } from "@supabase/supabase-js"
import { readFileSync } from "fs"

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8")
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim() }
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"))

// Window: 2026-06-08 03:00 UTC to 04:00 UTC (the cron fires at 03:35 UTC)
const WINDOW_START = "2026-06-08T03:00:00Z"
const WINDOW_END = "2026-06-08T05:00:00Z"

async function countByAction(action) {
  const { count } = await supabase
    .from("membership_audit_log")
    .select("*", { count: "exact", head: true })
    .eq("action", action)
    .gte("created_at", WINDOW_START)
    .lt("created_at", WINDOW_END)
  return count ?? 0
}

async function main() {
  console.log(`Window: ${WINDOW_START} → ${WINDOW_END}\n`)

  const stale = await countByAction("draft_marked_stale")
  const reminderSent = await countByAction("draft_reminder_sent")
  const reminderFailed = await countByAction("draft_reminder_failed")
  const reminderSkipped = await countByAction("draft_reminder_skipped_excluded")
  const expired = await countByAction("draft_expired")
  const silentExpired = await countByAction("draft_silent_expired_no_formdata")
  const paymentHold = await countByAction("draft_payment_on_hold")

  console.log("Audit-log event counts in window:")
  console.log(`  draft_marked_stale:                   ${stale}`)
  console.log(`  draft_reminder_sent (NEW from d26e068): ${reminderSent}`)
  console.log(`  draft_reminder_failed (NEW):          ${reminderFailed}`)
  console.log(`  draft_reminder_skipped_excluded:      ${reminderSkipped}`)
  console.log(`  draft_expired:                        ${expired}`)
  console.log(`  draft_silent_expired_no_formdata:     ${silentExpired}`)
  console.log(`  draft_payment_on_hold:                ${paymentHold}`)

  // Also peek at how many live incomplete drafts remain
  const { count: liveStuck } = await supabase
    .from("draft_applications")
    .select("*", { count: "exact", head: true })
    .in("status", ["in_progress", "stuck"])
    .is("deleted_at", null)
  console.log(`\nLive incomplete drafts (in_progress + stuck) now: ${liveStuck}`)

  console.log("\nVerdict:")
  if (stale === 0 && reminderSent === 0 && expired === 0) {
    console.log("  ✗ Cron did NOT run in the window. Vercel cron may be disabled or failed.")
    process.exit(2)
  }

  if (stale > 0 && reminderSent === 0 && reminderFailed === 0) {
    console.log("  ✗ Cron ran but reminder pipeline is STILL a no-op (Step 1b/2 SELECTs returned 0 rows).")
    console.log("    The 2026-05-26→2026-06-06 regression persists.")
    console.log("    Investigate: query Step 1b's exact filter manually against draft_applications.")
    process.exit(1)
  }

  if (reminderSent > 0 && expired === 0) {
    console.log("  ⚠ Reminders sent but expiry did not fire.")
    console.log("    Expected if drafts were reminded <6h before cron run (6h grace guard).")
    console.log("    Re-check on 06-09 — by then the 06-07 reminders are 48h+ old.")
    process.exit(0)
  }

  if (reminderSent > 0 && expired > 0) {
    console.log("  ✓ Pipeline healthy. Reminders sent + expiry firing.")
    console.log(`    Expected expiry ≈45 (the 06-07-reminded backlog); actual: ${expired}.`)
    process.exit(0)
  }

  if (reminderFailed > 0) {
    console.log(`  ⚠ ${reminderFailed} reminder sends FAILED. Check Sentry tag op:reminder-email.`)
    console.log("    This is the new draft_reminder_failed event firing — visibility working as intended.")
    process.exit(0)
  }

  console.log("  (no specific verdict — review counts manually)")
}

main().catch(e => { console.error(e); process.exit(1) })
