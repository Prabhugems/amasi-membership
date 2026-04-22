import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.local", "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };
const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));

async function main() {
  // 1. Fetch all draft_applications
  const { data: drafts, error: dErr } = await supabase
    .from("draft_applications")
    .select("id, email, phone, membership_type, current_step, status, failure_reason, payment_order_id, payment_id, has_verified_payment, stale_since, reminder_sent_at, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (dErr) { console.error("Error fetching drafts:", dErr); process.exit(1); }

  console.log(`\n========== ALL DRAFT APPLICATIONS (${drafts.length}) ==========\n`);

  if (drafts.length === 0) {
    console.log("No draft applications found.\n");
  }

  // Collect emails for cross-checks
  const emails = drafts.map(d => d.email).filter(Boolean);
  const orderIds = drafts.map(d => d.payment_order_id).filter(Boolean);

  // 2. Check which emails also have submitted applications
  const { data: submitted, error: sErr } = emails.length
    ? await supabase.from("membership_applications").select("id, email, status").in("email", emails)
    : { data: [], error: null };
  if (sErr) console.error("Error fetching membership_applications:", sErr);
  const submittedEmails = new Set((submitted || []).map(s => s.email));

  // 3. Check payments
  const { data: payments, error: pErr } = orderIds.length
    ? await supabase.from("membership_payments").select("id, email, order_id, payment_id, status, amount").in("order_id", orderIds)
    : { data: [], error: null };
  if (pErr) console.error("Error fetching membership_payments:", pErr);
  const paymentsByOrder = {};
  (payments || []).forEach(p => { paymentsByOrder[p.order_id] = p; });

  // Print each draft
  for (const d of drafts) {
    const hasSubmitted = submittedEmails.has(d.email);
    const payment = d.payment_order_id ? paymentsByOrder[d.payment_order_id] : null;

    console.log(`--- Draft ${d.id} ---`);
    console.log(`  Email:             ${d.email}`);
    console.log(`  Phone:             ${d.phone || "(none)"}`);
    console.log(`  Membership Type:   ${d.membership_type || "(none)"}`);
    console.log(`  Current Step:      ${d.current_step}`);
    console.log(`  Status:            ${d.status}`);
    console.log(`  Failure Reason:    ${d.failure_reason || "(none)"}`);
    console.log(`  Payment Order ID:  ${d.payment_order_id || "(none)"}`);
    console.log(`  Payment ID:        ${d.payment_id || "(none)"}`);
    console.log(`  Verified Payment:  ${d.has_verified_payment}`);
    console.log(`  Stale Since:       ${d.stale_since || "(not stale)"}`);
    console.log(`  Reminder Sent At:  ${d.reminder_sent_at || "(none)"}`);
    console.log(`  Created:           ${d.created_at}`);
    console.log(`  Updated:           ${d.updated_at}`);
    console.log(`  >> Also in membership_applications? ${hasSubmitted ? "YES" : "NO"}`);
    if (payment) {
      console.log(`  >> Payment found: status=${payment.status}, amount=${payment.amount}, payment_id=${payment.payment_id}`);
    } else if (d.payment_order_id) {
      console.log(`  >> ORPHANED PAYMENT ORDER: ${d.payment_order_id} — no matching record in membership_payments`);
    }
    console.log();
  }

  // 4. Summary
  console.log("========== SUMMARY ==========\n");

  // By status
  const byStatus = {};
  for (const d of drafts) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
  }
  console.log("Drafts by status:");
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log(`  TOTAL: ${drafts.length}\n`);

  // Orphaned payments (have order_id but no matching payment record)
  const orphaned = drafts.filter(d => d.payment_order_id && !paymentsByOrder[d.payment_order_id]);
  console.log(`Orphaned payments (order_id in draft but not in membership_payments): ${orphaned.length}`);
  for (const o of orphaned) {
    console.log(`  - ${o.email} → order ${o.payment_order_id}`);
  }

  // Duplicates: drafts whose email also appears in membership_applications
  const dupes = drafts.filter(d => submittedEmails.has(d.email));
  console.log(`\nDuplicates (email in both draft_applications AND membership_applications): ${dupes.length}`);
  for (const dup of dupes) {
    console.log(`  - ${dup.email} (draft status: ${dup.status})`);
  }

  // Also check for any payments NOT linked to a draft (truly orphaned)
  if (emails.length) {
    const { data: allPaymentsForEmails } = await supabase
      .from("membership_payments")
      .select("id, email, order_id, status, amount")
      .in("email", emails);
    const draftOrderIds = new Set(orderIds);
    const unlinked = (allPaymentsForEmails || []).filter(p => p.order_id && !draftOrderIds.has(p.order_id));
    if (unlinked.length) {
      console.log(`\nPayments for draft emails NOT linked to any draft order_id: ${unlinked.length}`);
      for (const u of unlinked) {
        console.log(`  - ${u.email} → order ${u.order_id}, status=${u.status}, amount=${u.amount}`);
      }
    }
  }

  console.log("\n========== END ==========\n");
}

main().catch(console.error);
