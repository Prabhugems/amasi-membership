// Re-align members.zone and membership_applications.zone to match the AMASI
// By-Laws 2023 Schedule § Guidelines for Zonal Chapters (Central Zone clause
// amended 5 Nov 2023, Raipur GBM).
//
// Before this script, src/lib/membership-types.ts STATE_TO_ZONE was a 4-zone
// map (no Central) and silently mis-mapped:
//   Delhi               North -> Central
//   Uttar Pradesh       North -> Central
//   Madhya Pradesh      West  -> Central
//   Chhattisgarh        West  -> Central
//   Andaman & Nicobar   East  -> South
// New applications written after the code fix will be correct on their own;
// this script realigns rows that were created before the code fix.
//
// Idempotent. Compares (state -> bylaw zone) against current `zone` and only
// updates rows where they differ. Safe to re-run.
//
// Usage:
//   node scripts/zone-realign-bylaw-2026-06-06.mjs           # dry-run (default)
//   node scripts/zone-realign-bylaw-2026-06-06.mjs --apply   # write changes

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const APPLY = process.argv.includes("--apply");

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

// Source of truth: AMASI By-Laws 2023 Schedule § Zonal Chapters.
// Keep in sync with src/lib/membership-types.ts STATE_TO_ZONE.
const STATE_TO_ZONE = {
  "Tamil Nadu": "South Zone", "Karnataka": "South Zone", "Kerala": "South Zone",
  "Andhra Pradesh": "South Zone", "Telangana": "South Zone",
  "Andaman and Nicobar Islands": "South Zone", "Lakshadweep": "South Zone",
  "Puducherry": "South Zone",
  "Maharashtra": "West Zone", "Goa": "West Zone", "Gujarat": "West Zone",
  "Dadra and Nagar Haveli and Daman and Diu": "West Zone",
  "Madhya Pradesh": "Central Zone", "Chhattisgarh": "Central Zone",
  "Delhi": "Central Zone", "Uttar Pradesh": "Central Zone",
  "Jammu and Kashmir": "North Zone", "Ladakh": "North Zone",
  "Himachal Pradesh": "North Zone", "Punjab": "North Zone",
  "Chandigarh": "North Zone", "Haryana": "North Zone",
  "Uttarakhand": "North Zone", "Rajasthan": "North Zone",
  "Bihar": "East Zone", "Jharkhand": "East Zone", "West Bengal": "East Zone",
  "Odisha": "East Zone", "Assam": "East Zone", "Arunachal Pradesh": "East Zone",
  "Manipur": "East Zone", "Sikkim": "East Zone", "Meghalaya": "East Zone",
  "Mizoram": "East Zone", "Nagaland": "East Zone", "Tripura": "East Zone",
};

const PAGE = 1000;

async function fetchAll(table, cols) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(cols)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`fetch ${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

function plan(rows, stateKey = "state", zoneKey = "zone") {
  const updates = [];
  const skipped = { noState: 0, unknownState: 0, alreadyCorrect: 0 };
  for (const r of rows) {
    const state = r[stateKey];
    if (!state) { skipped.noState++; continue; }
    const expected = STATE_TO_ZONE[state];
    if (!expected) { skipped.unknownState++; continue; }
    if (r[zoneKey] === expected) { skipped.alreadyCorrect++; continue; }
    updates.push({ id: r.id, state, oldZone: r[zoneKey] || null, newZone: expected });
  }
  return { updates, skipped };
}

function summarizeMoves(updates) {
  const buckets = new Map();
  for (const u of updates) {
    const k = `${u.oldZone ?? "(null)"} -> ${u.newZone}  [${u.state}]`;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  return [...buckets.entries()].sort((a, b) => b[1] - a[1]);
}

async function applyUpdates(table, updates) {
  let ok = 0, fail = 0;
  for (const u of updates) {
    const { error } = await supabase
      .from(table)
      .update({ zone: u.newZone })
      .eq("id", u.id);
    if (error) { fail++; console.error(`  ✗ ${table} id=${u.id}: ${error.message}`); }
    else { ok++; }
  }
  return { ok, fail };
}

async function writeAuditLog(table, updates) {
  if (updates.length === 0) return;
  // Schema: action, entity_type, entity_id (NOT NULL), old_data, new_data,
  // performed_by. See src/lib/audit-log.ts for the canonical helper.
  const { error } = await supabase.from("membership_audit_log").insert({
    action: "zone_realign_bylaw_2023",
    entity_type: table === "members" ? "member" : "membership_application",
    entity_id: "bulk",
    performed_by: "admin (Prabhu via Claude Code)",
    new_data: {
      table,
      updated_count: updates.length,
      moves: summarizeMoves(updates).map(([k, n]) => ({ shift: k, count: n })),
      sample_ids: updates.slice(0, 20).map((u) => u.id),
      bylaw_reference: "AMASI By-Laws 2023, Schedule § Zonal Chapters (Central Zone amended 5 Nov 2023 Raipur GBM)",
      ran_at: new Date().toISOString(),
    },
  });
  if (error) console.error(`  ⚠ audit-log write failed (non-blocking): ${error.message}`);
  else console.log(`  ✓ audit log written for ${table}`);
}

async function processTable(table, cols) {
  console.log(`\n--- ${table} ---`);
  const rows = await fetchAll(table, cols);
  console.log(`  fetched ${rows.length} rows`);
  const { updates, skipped } = plan(rows);
  console.log(`  skipped: noState=${skipped.noState}  unknownState=${skipped.unknownState}  alreadyCorrect=${skipped.alreadyCorrect}`);
  console.log(`  to-update: ${updates.length}`);
  if (updates.length > 0) {
    console.log(`  moves:`);
    for (const [shift, n] of summarizeMoves(updates)) {
      console.log(`    ${n.toString().padStart(5)}  ${shift}`);
    }
  }
  if (APPLY && updates.length > 0) {
    console.log(`  applying...`);
    const { ok, fail } = await applyUpdates(table, updates);
    console.log(`  ✓ ${ok} updated, ✗ ${fail} failed`);
    await writeAuditLog(table, updates.slice(0, ok));
  }
  return updates.length;
}

async function main() {
  console.log("\n========== ZONE REALIGN (bylaw 2023) ==========");
  console.log(APPLY ? "MODE: APPLY (writing changes)" : "MODE: DRY-RUN (no writes). Pass --apply to commit.\n");

  const memberUpdates = await processTable("members", "id, state, zone");
  const appUpdates = await processTable("membership_applications", "id, state, zone");

  console.log("\n========== SUMMARY ==========");
  console.log(`  members             : ${memberUpdates} ${APPLY ? "updated" : "would-update"}`);
  console.log(`  membership_apps     : ${appUpdates} ${APPLY ? "updated" : "would-update"}`);
  if (!APPLY) console.log(`\nRe-run with --apply to commit.`);
}

main().catch((e) => { console.error("\n!!! FAILED:", e.message); process.exit(1); });
