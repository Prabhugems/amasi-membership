/**
 * Test script for Incomplete Applications API endpoints
 * Tests GET /api/applications/incomplete with various query params
 * Also validates against direct Supabase queries for data consistency
 */

const BASE = "http://localhost:3000";
const SUPABASE_URL = "https://jmdwxymbgxwdsmcwbahp.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Helpers ────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}${detail ? " — " + detail : ""}`);
    failed++;
  }
}

async function supabaseQuery(table, params = "") {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${table} query failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ─── Auth ───────────────────────────────────────────────────────────────────

async function login() {
  console.log("\n=== Authenticating as admin ===");
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@amasi.org", password: "Amasi@2026" }),
  });
  const cookie = res.headers.get("set-cookie");
  const body = await res.json();
  console.log(`  Login status: ${res.status}`);
  console.log(`  Response: ${JSON.stringify(body).slice(0, 200)}`);
  assert(res.status === 200, "Admin login returns 200");
  assert(cookie, "Login sets a cookie");
  return cookie;
}

// ─── Direct Supabase baseline ───────────────────────────────────────────────

async function getSupabaseCounts() {
  console.log("\n=== Supabase direct: draft_applications counts ===");
  const rows = await supabaseQuery("draft_applications", "select=status");
  const total = rows.length;
  const in_progress = rows.filter((r) => r.status === "in_progress").length;
  const stuck = rows.filter((r) => r.status === "stuck").length;
  const payment_on_hold = rows.filter((r) => r.status === "payment_on_hold").length;
  const refund_initiated = rows.filter((r) => r.status === "refund_initiated").length;
  const completed = rows.filter((r) => r.status === "completed").length;
  const expired = rows.filter((r) => r.status === "expired").length;

  console.log(`  total=${total}  in_progress=${in_progress}  stuck=${stuck}  payment_on_hold=${payment_on_hold}  refund_initiated=${refund_initiated}  completed=${completed}  expired=${expired}`);
  return { total, in_progress, stuck, payment_on_hold, refund_initiated, completed, expired };
}

async function getSupabaseFiltered(status) {
  let params;
  if (status === "all") {
    // The API excludes completed and expired
    params = "select=id,status,email&status=not.in.(completed,expired)&order=created_at.desc";
  } else {
    params = `select=id,status,email&status=eq.${status}&order=created_at.desc`;
  }
  return supabaseQuery("draft_applications", params);
}

// ─── API Tests ──────────────────────────────────────────────────────────────

async function testCounts(cookie, sbCounts) {
  console.log("\n=== Test 1: GET ?action=counts ===");
  const res = await fetch(`${BASE}/api/applications/incomplete?action=counts`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Body: ${JSON.stringify(body)}`);

  assert(res.status === 200, "Returns 200");
  assert(typeof body.total === "number", "Has total field");
  assert(typeof body.in_progress === "number", "Has in_progress field");
  assert(typeof body.stuck === "number", "Has stuck field");
  assert(typeof body.payment_on_hold === "number", "Has payment_on_hold field");
  assert(typeof body.refund_initiated === "number", "Has refund_initiated field");

  // Cross-check against Supabase
  assert(body.total === sbCounts.total, `total matches Supabase (API=${body.total}, SB=${sbCounts.total})`);
  assert(body.in_progress === sbCounts.in_progress, `in_progress matches (API=${body.in_progress}, SB=${sbCounts.in_progress})`);
  assert(body.stuck === sbCounts.stuck, `stuck matches (API=${body.stuck}, SB=${sbCounts.stuck})`);
  assert(body.payment_on_hold === sbCounts.payment_on_hold, `payment_on_hold matches (API=${body.payment_on_hold}, SB=${sbCounts.payment_on_hold})`);
  assert(body.refund_initiated === sbCounts.refund_initiated, `refund_initiated matches (API=${body.refund_initiated}, SB=${sbCounts.refund_initiated})`);
}

async function testListAll(cookie, sbCounts) {
  console.log("\n=== Test 2: GET ?status=all ===");
  const res = await fetch(`${BASE}/api/applications/incomplete?status=all`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Drafts count: ${body.drafts?.length ?? "N/A"}`);

  assert(res.status === 200, "Returns 200");
  assert(Array.isArray(body.drafts), "drafts is an array");

  // status=all should exclude completed and expired
  const expectedCount = sbCounts.total - sbCounts.completed - sbCounts.expired;
  const sbAll = await getSupabaseFiltered("all");
  console.log(`  Expected (excl completed+expired): ${expectedCount}, Supabase filtered: ${sbAll.length}`);

  assert(body.drafts.length === sbAll.length, `List count matches Supabase (API=${body.drafts.length}, SB=${sbAll.length})`);

  // Verify no completed/expired in results
  const badStatuses = body.drafts.filter((d) => d.status === "completed" || d.status === "expired");
  assert(badStatuses.length === 0, `No completed/expired in 'all' results (found ${badStatuses.length})`);

  // Verify ordering is desc by created_at
  if (body.drafts.length >= 2) {
    const dates = body.drafts.map((d) => new Date(d.created_at).getTime());
    const isSorted = dates.every((d, i) => i === 0 || dates[i - 1] >= d);
    assert(isSorted, "Results sorted by created_at desc");
  } else {
    console.log("  SKIP: Not enough drafts to verify sort order");
  }

  // Show first few drafts for inspection
  if (body.drafts.length > 0) {
    console.log("  Sample drafts:");
    body.drafts.slice(0, 3).forEach((d) => {
      console.log(`    - ${d.email} | step=${d.current_step} | status=${d.status} | created=${d.created_at}`);
    });
  }
}

async function testFilterStuck(cookie) {
  console.log("\n=== Test 3: GET ?status=stuck ===");
  const res = await fetch(`${BASE}/api/applications/incomplete?status=stuck`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Drafts count: ${body.drafts?.length ?? "N/A"}`);

  assert(res.status === 200, "Returns 200");
  assert(Array.isArray(body.drafts), "drafts is an array");

  const sbStuck = await getSupabaseFiltered("stuck");
  assert(body.drafts.length === sbStuck.length, `Stuck count matches Supabase (API=${body.drafts.length}, SB=${sbStuck.length})`);

  // Every draft should have status=stuck
  const allStuck = body.drafts.every((d) => d.status === "stuck");
  assert(allStuck, `All returned drafts have status=stuck`);
}

async function testFilterInProgress(cookie) {
  console.log("\n=== Test 4: GET ?status=in_progress ===");
  const res = await fetch(`${BASE}/api/applications/incomplete?status=in_progress`, {
    headers: { Cookie: cookie },
  });
  const body = await res.json();
  console.log(`  Status: ${res.status}`);
  console.log(`  Drafts count: ${body.drafts?.length ?? "N/A"}`);

  assert(res.status === 200, "Returns 200");
  assert(Array.isArray(body.drafts), "drafts is an array");

  const sbInProgress = await getSupabaseFiltered("in_progress");
  assert(body.drafts.length === sbInProgress.length, `in_progress count matches Supabase (API=${body.drafts.length}, SB=${sbInProgress.length})`);

  const allInProgress = body.drafts.every((d) => d.status === "in_progress");
  assert(allInProgress, `All returned drafts have status=in_progress`);
}

// ─── Bonus: auth guard test ────────────────────────────────────────────────

async function testUnauthorized() {
  console.log("\n=== Test 5: Unauthorized access (no cookie) ===");
  const res = await fetch(`${BASE}/api/applications/incomplete?action=counts`);
  const body = await res.json();
  console.log(`  Status: ${res.status}`);
  assert(res.status === 401, "Returns 401 without auth cookie");
  assert(body.error === "Unauthorized", `Error message is "Unauthorized"`);
}

// ─── Data consistency checks ────────────────────────────────────────────────

async function checkDataConsistencies() {
  console.log("\n=== Data Consistency Checks ===");

  const allRows = await supabaseQuery(
    "draft_applications",
    "select=id,email,status,current_step,has_verified_payment,payment_order_id,failure_reason,stale_since,created_at,updated_at"
  );

  // Check: stuck drafts should have stale_since or failure_reason
  const stuckRows = allRows.filter((r) => r.status === "stuck");
  const stuckNoReason = stuckRows.filter((r) => !r.failure_reason && !r.stale_since);
  if (stuckNoReason.length > 0) {
    console.log(`  WARNING: ${stuckNoReason.length} stuck drafts with no failure_reason and no stale_since:`);
    stuckNoReason.forEach((r) => console.log(`    - ${r.email} (id=${r.id})`));
  } else if (stuckRows.length > 0) {
    console.log(`  OK: All ${stuckRows.length} stuck drafts have failure_reason or stale_since`);
  } else {
    console.log(`  INFO: No stuck drafts in the system`);
  }

  // Check: payment_on_hold should have payment_order_id
  const holdRows = allRows.filter((r) => r.status === "payment_on_hold");
  const holdNoOrder = holdRows.filter((r) => !r.payment_order_id);
  if (holdNoOrder.length > 0) {
    console.log(`  WARNING: ${holdNoOrder.length} payment_on_hold drafts without payment_order_id:`);
    holdNoOrder.forEach((r) => console.log(`    - ${r.email} (id=${r.id})`));
  } else if (holdRows.length > 0) {
    console.log(`  OK: All ${holdRows.length} payment_on_hold drafts have payment_order_id`);
  } else {
    console.log(`  INFO: No payment_on_hold drafts in the system`);
  }

  // Check: current_step should be 1-6
  const badStep = allRows.filter((r) => r.current_step < 1 || r.current_step > 6);
  if (badStep.length > 0) {
    console.log(`  WARNING: ${badStep.length} drafts with current_step outside 1-6:`);
    badStep.forEach((r) => console.log(`    - ${r.email} step=${r.current_step}`));
  } else {
    console.log(`  OK: All ${allRows.length} drafts have valid current_step (1-6)`);
  }

  // Check: completed drafts should have has_verified_payment = true (if they exist)
  const completedRows = allRows.filter((r) => r.status === "completed");
  const completedNoPay = completedRows.filter((r) => !r.has_verified_payment);
  if (completedNoPay.length > 0) {
    console.log(`  WARNING: ${completedNoPay.length} completed drafts without verified payment:`);
    completedNoPay.forEach((r) => console.log(`    - ${r.email}`));
  } else if (completedRows.length > 0) {
    console.log(`  OK: All ${completedRows.length} completed drafts have verified payment`);
  }

  // Status distribution
  console.log("\n  Status distribution:");
  const statusMap = {};
  allRows.forEach((r) => {
    statusMap[r.status] = (statusMap[r.status] || 0) + 1;
  });
  for (const [s, c] of Object.entries(statusMap)) {
    console.log(`    ${s}: ${c}`);
  }

  // Step distribution
  console.log("\n  Step distribution:");
  const stepMap = {};
  allRows.forEach((r) => {
    const label = `Step ${r.current_step}`;
    stepMap[label] = (stepMap[label] || 0) + 1;
  });
  for (const [s, c] of Object.entries(stepMap).sort()) {
    console.log(`    ${s}: ${c}`);
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Incomplete Applications API Test Suite ===");
  console.log(`Base URL: ${BASE}`);
  console.log(`Supabase: ${SUPABASE_URL}`);

  if (!SUPABASE_KEY) {
    console.error("ERROR: SUPABASE_SERVICE_ROLE_KEY not set. Run with:");
    console.error("  source .env.local && node scripts/test-incomplete-api.mjs");
    process.exit(1);
  }

  try {
    // Step 1: Login
    const cookie = await login();
    if (!cookie) {
      console.error("FATAL: Could not authenticate. Aborting API tests.");
      // Still run Supabase-only checks
      const sbCounts = await getSupabaseCounts();
      await checkDataConsistencies();
      return;
    }

    // Step 2: Get Supabase baseline
    const sbCounts = await getSupabaseCounts();

    // Step 3: Run API tests
    await testCounts(cookie, sbCounts);
    await testListAll(cookie, sbCounts);
    await testFilterStuck(cookie);
    await testFilterInProgress(cookie);
    await testUnauthorized();

    // Step 4: Data consistency
    await checkDataConsistencies();

  } catch (err) {
    console.error("\nFATAL ERROR:", err.message);
    console.error(err.stack);
  }

  // Summary
  console.log("\n════════════════════════════════");
  console.log(`  PASSED: ${passed}`);
  console.log(`  FAILED: ${failed}`);
  console.log(`  TOTAL:  ${passed + failed}`);
  console.log("════════════════════════════════");
  process.exit(failed > 0 ? 1 : 0);
}

main();
