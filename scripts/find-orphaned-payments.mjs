/**
 * find-orphaned-payments.mjs
 *
 * Finds all membership_payments rows where:
 *   - application_id IS NULL  AND  status = 'paid'
 *
 * For each orphan it checks:
 *   1. Does an application exist with a matching email?
 *   2. What does the Razorpay order say (notes → email, reference)?
 *   3. Does the email have a draft_application?
 *
 * Usage:  node scripts/find-orphaned-payments.mjs
 */

import { createClient } from "@supabase/supabase-js";
import Razorpay from "razorpay";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ── env ──────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "../.env.local");
const envFile = readFileSync(envPath, "utf8");
const getEnv = (k) => {
  const re = new RegExp(k + '=["\']?([^"\'\\n]+)');
  const m = envFile.match(re);
  return m?.[1]?.trim();
};

const supabase = createClient(
  getEnv("NEXT_PUBLIC_SUPABASE_URL"),
  getEnv("SUPABASE_SERVICE_ROLE_KEY")
);

const razorpay = new Razorpay({
  key_id: getEnv("RAZORPAY_KEY_ID"),
  key_secret: getEnv("RAZORPAY_KEY_SECRET"),
});

// ── helpers ──────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRazorpayOrder(orderId) {
  try {
    const order = await razorpay.orders.fetch(orderId);
    return order;
  } catch (err) {
    return { error: err?.error?.description || err?.message || "unknown" };
  }
}

// ── main ─────────────────────────────────────────────────────────────
async function main() {
  console.log("\n🔍  Finding orphaned payments (paid, no application_id)...\n");

  // 1. Query orphaned payments
  const { data: orphans, error: oErr } = await supabase
    .from("membership_payments")
    .select("id, member_email, gateway_order_id, gateway_payment_id, status, amount, currency, fee_breakdown, created_at")
    .is("application_id", null)
    .eq("status", "paid")
    .order("created_at", { ascending: false });

  if (oErr) {
    console.error("Error querying membership_payments:", oErr);
    process.exit(1);
  }

  console.log(`Found ${orphans.length} orphaned payment(s).\n`);

  if (orphans.length === 0) {
    console.log("Nothing to report.");
    return;
  }

  // Collect unique emails for batch lookups
  const allEmails = new Set();
  for (const p of orphans) {
    if (p.member_email) allEmails.add(p.member_email.toLowerCase());
    const feEmail = p.fee_breakdown?.applicant_email;
    if (feEmail) allEmails.add(feEmail.toLowerCase());
  }

  // 2. Batch-check membership_applications by email
  const emailArr = [...allEmails];
  let appsByEmail = {};
  if (emailArr.length) {
    const { data: apps } = await supabase
      .from("membership_applications")
      .select("id, email, reference_number, status, payment_status, created_at")
      .in("email", emailArr);
    for (const a of apps || []) {
      const key = a.email?.toLowerCase();
      if (!appsByEmail[key]) appsByEmail[key] = [];
      appsByEmail[key].push(a);
    }
  }

  // 3. Batch-check draft_applications by email
  let draftsByEmail = {};
  if (emailArr.length) {
    const { data: drafts } = await supabase
      .from("draft_applications")
      .select("id, email, status, current_step, has_verified_payment, payment_order_id, payment_id, created_at, updated_at")
      .in("email", emailArr);
    for (const d of drafts || []) {
      const key = d.email?.toLowerCase();
      if (!draftsByEmail[key]) draftsByEmail[key] = [];
      draftsByEmail[key].push(d);
    }
  }

  // 4. For each orphan, fetch Razorpay order notes
  const results = [];

  for (const p of orphans) {
    // Determine email from multiple sources
    const feEmail = p.fee_breakdown?.applicant_email;
    const email = (feEmail || p.member_email || "").toLowerCase();

    // Fetch Razorpay order
    let rzpOrder = null;
    let rzpEmail = null;
    let rzpRef = null;
    let rzpName = null;
    let rzpType = null;

    if (p.gateway_order_id) {
      rzpOrder = await fetchRazorpayOrder(p.gateway_order_id);
      if (!rzpOrder.error) {
        rzpEmail = rzpOrder.notes?.email?.toLowerCase() || null;
        rzpRef = rzpOrder.notes?.reference_number || null;
        rzpName = rzpOrder.notes?.name || null;
        rzpType = rzpOrder.notes?.membership_type || null;
      }
      // rate-limit: 1 req/100ms to stay under Razorpay limits
      await sleep(150);
    }

    // Use the best email we have
    const bestEmail = rzpEmail || email || null;

    // Check applications
    const matchingApps = bestEmail ? (appsByEmail[bestEmail] || []) : [];

    // Check drafts
    const matchingDrafts = bestEmail ? (draftsByEmail[bestEmail] || []) : [];

    results.push({
      paymentId: p.id,
      gatewayPaymentId: p.gateway_payment_id,
      gatewayOrderId: p.gateway_order_id,
      amount: p.amount,
      currency: p.currency,
      paymentDate: p.created_at,
      source: "unknown",

      // Email resolution
      memberEmail: p.member_email,
      feeBreakdownEmail: feEmail || null,
      razorpayEmail: rzpEmail,
      bestEmail,

      // Razorpay order
      razorpayRef: rzpRef,
      razorpayName: rzpName,
      razorpayType: rzpType,
      razorpayOrderError: rzpOrder?.error || null,

      // Application match
      hasApplication: matchingApps.length > 0,
      applications: matchingApps,

      // Draft match
      hasDraft: matchingDrafts.length > 0,
      drafts: matchingDrafts,
    });
  }

  // ── Report ─────────────────────────────────────────────────────────
  console.log("=".repeat(80));
  console.log("  ORPHANED PAYMENTS REPORT");
  console.log("  Paid but NO application_id linked");
  console.log("=".repeat(80));

  for (const r of results) {
    console.log(`\n--- Payment ${r.paymentId} ---`);
    console.log(`  Gateway Payment ID:  ${r.gatewayPaymentId || "(none)"}`);
    console.log(`  Gateway Order ID:    ${r.gatewayOrderId || "(none)"}`);
    console.log(`  Amount:              ${r.amount} ${r.currency}`);
    console.log(`  Payment Date:        ${r.paymentDate}`);
    console.log(`  Source:              ${r.source}`);
    console.log(`  member_email col:    ${r.memberEmail || "(null)"}`);
    console.log(`  fee_breakdown email: ${r.feeBreakdownEmail || "(null)"}`);
    console.log(`  Razorpay email:      ${r.razorpayEmail || "(unknown)"}`);
    console.log(`  Best email:          ${r.bestEmail || "UNKNOWN"}`);
    console.log(`  Razorpay reference:  ${r.razorpayRef || "(none)"}`);
    console.log(`  Razorpay name:       ${r.razorpayName || "(none)"}`);
    console.log(`  Razorpay type:       ${r.razorpayType || "(none)"}`);
    if (r.razorpayOrderError) {
      console.log(`  Razorpay order err:  ${r.razorpayOrderError}`);
    }
    console.log(`  Has application?     ${r.hasApplication ? "YES" : "NO"}`);
    if (r.hasApplication) {
      for (const a of r.applications) {
        console.log(`    -> App ${a.id}: ref=${a.reference_number}, status=${a.status}, payment=${a.payment_status}`);
      }
    }
    console.log(`  Has draft?           ${r.hasDraft ? "YES" : "NO"}`);
    if (r.hasDraft) {
      for (const d of r.drafts) {
        console.log(`    -> Draft ${d.id}: status=${d.status}, step=${d.current_step}, verified_payment=${d.has_verified_payment}, order=${d.payment_order_id || "(none)"}`);
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────
  const totalOrphans = results.length;
  const noAppNoRef = results.filter((r) => !r.hasApplication && !r.razorpayRef);
  const hasAppButUnlinked = results.filter((r) => r.hasApplication);
  const hasDraft = results.filter((r) => r.hasDraft);
  const trulyLost = results.filter((r) => !r.hasApplication && !r.hasDraft);
  const totalAmount = results.reduce((sum, r) => sum + (r.amount || 0), 0);

  console.log("\n" + "=".repeat(80));
  console.log("  SUMMARY");
  console.log("=".repeat(80));
  console.log(`  Total orphaned payments (paid, no application_id):  ${totalOrphans}`);
  console.log(`  Total amount:                                       ${totalAmount}`);
  console.log(`  Has matching application (unlinked):                 ${hasAppButUnlinked.length}`);
  console.log(`  Has draft application:                               ${hasDraft.length}`);
  console.log(`  No app AND no draft (truly lost):                    ${trulyLost.length}`);
  console.log(`  No app AND no Razorpay reference:                    ${noAppNoRef.length}`);

  if (trulyLost.length > 0) {
    console.log("\n  TRULY LOST — paid but no application or draft:");
    for (const r of trulyLost) {
      console.log(`    - ${r.bestEmail || "UNKNOWN EMAIL"} | ${r.amount} ${r.currency} | ${r.paymentDate} | ref=${r.razorpayRef || "none"} | name=${r.razorpayName || "unknown"}`);
    }
  }

  if (hasAppButUnlinked.length > 0) {
    console.log("\n  LINKABLE — application exists but payment not linked:");
    for (const r of hasAppButUnlinked) {
      console.log(`    - ${r.bestEmail} | ${r.amount} ${r.currency} | app ref=${r.applications[0]?.reference_number} | app status=${r.applications[0]?.status}`);
    }
  }

  console.log("\n" + "=".repeat(80));
  console.log("  END OF REPORT");
  console.log("=".repeat(80) + "\n");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
