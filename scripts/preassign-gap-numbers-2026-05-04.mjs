// Pre-assign 6 gap-fill amasi_numbers to the 6 oldest legacy imports so that
// when an admin clicks Approve on each, they land on the burned sequence
// numbers instead of advancing the sequence. The two newest legacy imports
// stay null and use the regular sequence.
//
// Gap numbers (verified missing in members table on 2026-05-04):
//   18260, 18261, 18278, 18279, 18280, 18281
//
// Pairing: oldest-first by legacy created_on. Source data:
// /Users/prabhu/Downloads/member_data-5-4-2026.sql
//
// Companion change: src/app/api/applications/approve/route.ts now honors
// `app.assigned_amasi_number` when set, skipping the next_amasi_number RPC.
//
// Idempotent: re-running is a no-op (UPDATE … WHERE assigned_amasi_number IS NULL).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync("/Users/prabhu/amasi-membership/.env.local", "utf8");
const get = (k) => env.match(new RegExp(`${k}=["']?([^"'\\n]+)`))?.[1];
const supabase = createClient(get("NEXT_PUBLIC_SUPABASE_URL"), get("SUPABASE_SERVICE_ROLE_KEY"));

const DRY_RUN = process.argv.includes("--dry-run");

// Oldest → newest legacy created_on among the 8 imported applications:
//   2026-04-15  Birender Yadav   birenderk783@gmail.com         → 18260
//   2026-04-27  Deepika Meena    deepika18meena@gmail.com       → 18261
//   2026-04-29  Aditi Singhal    dr.aditi.arya@gmail.com        → 18278
//   2026-04-30  Prakhar Verma    drprakhar11@gmail.com          → 18279
//   2026-05-02  Shwetank C.      shwetankchoudhary94@gmail.com  → 18280
//   2026-05-02  Akanksha Yadav   snkrishnahospital@gmail.com    → 18281
//   2026-05-03  Shikha Bharti    shikhaa.bharti@gmail.com       → (sequence)
//   2026-05-04  Debasmita Mondal debasmitamondal67@gmail.com    → (sequence)
const PAIRS = [
  ["birenderk783@gmail.com",        18260],
  ["deepika18meena@gmail.com",      18261],
  ["dr.aditi.arya@gmail.com",       18278],
  ["drprakhar11@gmail.com",         18279],
  ["shwetankchoudhary94@gmail.com", 18280],
  ["snkrishnahospital@gmail.com",   18281],
];

// Sanity: confirm each gap number is still actually missing in members.
console.log("--- Verifying gap numbers are unused ---");
for (const [, n] of PAIRS) {
  const { data: hit } = await supabase
    .from("members")
    .select("amasi_number, name, email")
    .eq("amasi_number", n)
    .maybeSingle();
  if (hit) {
    console.error(`ABORT: ${n} is already taken by ${hit.name} (${hit.email}). Re-pick gap numbers.`);
    process.exit(1);
  }
  console.log(`  ${n}  unused ✓`);
}

// Sanity: confirm each application exists, is pending_review, has no
// pre-existing assignment, and is one of our legacy imports.
console.log("\n--- Verifying target applications ---");
const targets = [];
for (const [email, n] of PAIRS) {
  const { data: app } = await supabase
    .from("membership_applications")
    .select("id, reference_number, name, email, status, assigned_amasi_number, manual_review_reason")
    .eq("email", email)
    .ilike("manual_review_reason", "legacy_import:%")
    .maybeSingle();
  if (!app) {
    console.error(`ABORT: no legacy_import application found for ${email}.`);
    process.exit(1);
  }
  if (app.status !== "pending_review") {
    console.error(`ABORT: ${email} is in status '${app.status}', expected 'pending_review'.`);
    process.exit(1);
  }
  if (app.assigned_amasi_number != null && app.assigned_amasi_number !== n) {
    console.error(`ABORT: ${email} already has assigned_amasi_number=${app.assigned_amasi_number}, expected null or ${n}.`);
    process.exit(1);
  }
  console.log(`  ${app.reference_number}  ${app.name.padEnd(22)} → ${n}`);
  targets.push({ id: app.id, ref: app.reference_number, name: app.name, n });
}

if (DRY_RUN) {
  console.log("\nDRY RUN — no writes. Re-run without --dry-run to apply.");
  process.exit(0);
}

console.log("\n--- Pre-assigning ---");
let ok = 0, fail = 0;
for (const t of targets) {
  const { error } = await supabase
    .from("membership_applications")
    .update({ assigned_amasi_number: t.n, updated_at: new Date().toISOString() })
    .eq("id", t.id)
    .is("assigned_amasi_number", null); // idempotency guard
  if (error) {
    console.error(`FAIL ${t.ref} → ${t.n}: ${error.message}`);
    fail++;
  } else {
    console.log(`OK   ${t.ref}  ${t.name.padEnd(22)} → ${t.n}`);
    ok++;
  }
}
console.log(`\nDone. updated=${ok}, failed=${fail}`);
