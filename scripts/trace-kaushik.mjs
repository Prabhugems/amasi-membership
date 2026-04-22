import { createClient } from "@supabase/supabase-js";
import Razorpay from "razorpay";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const razorpay = new Razorpay({
  key_id: getEnv("RAZORPAY_KEY_ID"),
  key_secret: getEnv("RAZORPAY_KEY_SECRET"),
});

const EMAIL = "krkaushik22@gmail.com";
const ORDER_ID = "order_SgU5e4ocoufqpn";
const PAYMENT_ID = "pay_SgU6nNFhsvUchy";

function ts(iso) {
  if (!iso) return "(null)";
  const d = new Date(iso);
  return d.toISOString().replace("T", " ").replace("Z", " UTC");
}

function diffMinutes(a, b) {
  if (!a || !b) return null;
  return ((new Date(b) - new Date(a)) / 60000).toFixed(1);
}

async function main() {
  console.log("=".repeat(70));
  console.log("KAUSHIK FAILURE TRACE — " + EMAIL);
  console.log("=".repeat(70));

  // 1. ALL OTP records
  console.log("\n--- 1. OTP RECORDS ---");
  const { data: otps, error: otpErr } = await supabase
    .from("otp_codes")
    .select("*")
    .eq("email", EMAIL)
    .order("created_at", { ascending: true });

  if (otpErr) console.error("OTP query error:", otpErr);
  if (!otps?.length) {
    console.log("  NO OTP records found for this email.");
  } else {
    for (const o of otps) {
      console.log(`  OTP id=${o.id}`);
      console.log(`    code=${o.code}, verified=${o.verified}, attempts=${o.attempts}`);
      console.log(`    created_at:  ${ts(o.created_at)}`);
      console.log(`    expires_at:  ${ts(o.expires_at)}`);
      console.log(`    channel:     ${o.channel || "email"}`);
      console.log();
    }
  }

  // 2. Draft record
  console.log("--- 2. DRAFT APPLICATION ---");
  const { data: drafts, error: dErr } = await supabase
    .from("draft_applications")
    .select("*")
    .eq("email", EMAIL)
    .order("created_at", { ascending: true });

  if (dErr) console.error("Draft query error:", dErr);
  if (!drafts?.length) {
    console.log("  NO draft found.");
  } else {
    for (const d of drafts) {
      console.log(`  Draft id=${d.id}`);
      console.log(`    membership_type: ${d.membership_type}`);
      console.log(`    current_step:    ${d.current_step}`);
      console.log(`    status:          ${d.status}`);
      console.log(`    payment_order_id: ${d.payment_order_id || "(none)"}`);
      console.log(`    payment_id:      ${d.payment_id || "(none)"}`);
      console.log(`    has_verified_payment: ${d.has_verified_payment}`);
      console.log(`    failure_reason:  ${d.failure_reason || "(none)"}`);
      console.log(`    stale_since:     ${ts(d.stale_since)}`);
      console.log(`    created_at:      ${ts(d.created_at)}`);
      console.log(`    updated_at:      ${ts(d.updated_at)}`);
      console.log(`    formData keys:   ${d.form_data ? Object.keys(d.form_data).join(", ") : "(no form_data)"}`);
      console.log(`    step_data keys:  ${d.step_data ? Object.keys(d.step_data).join(", ") : "(no step_data)"}`);
      console.log();
    }
  }

  // 3. Membership applications
  console.log("--- 3. MEMBERSHIP APPLICATIONS ---");
  const { data: apps, error: aErr } = await supabase
    .from("membership_applications")
    .select("*")
    .eq("email", EMAIL);

  if (aErr) console.error("Applications query error:", aErr);
  if (!apps?.length) {
    console.log("  NO membership_applications found — confirms submit NEVER succeeded.");
  } else {
    for (const a of apps) {
      console.log(`  Application id=${a.id}, status=${a.status}, created=${ts(a.created_at)}`);
    }
  }

  // 4. Membership payments
  console.log("\n--- 4. MEMBERSHIP PAYMENTS ---");
  const { data: payments, error: pErr } = await supabase
    .from("membership_payments")
    .select("*")
    .or(`member_email.eq.${EMAIL},gateway_order_id.eq.${ORDER_ID}`);

  if (pErr) console.error("Payments query error:", pErr);
  if (!payments?.length) {
    console.log("  NO payment records in membership_payments.");
  } else {
    for (const p of payments) {
      console.log(`  Payment id=${p.id}`);
      console.log(`    email: ${p.member_email}, order_id: ${p.gateway_order_id}, payment_id: ${p.gateway_payment_id}`);
      console.log(`    status: ${p.status}, amount: ${p.amount}, application_id: ${p.application_id || "NULL"}`);
      console.log(`    fee_breakdown: ${JSON.stringify(p.fee_breakdown)}`);
      console.log(`    created_at: ${ts(p.created_at)}`);
      console.log();
    }
  }

  // 5. Audit log
  console.log("--- 5. MEMBERSHIP AUDIT LOG ---");
  const { data: audits, error: auErr } = await supabase
    .from("membership_audit_log")
    .select("*")
    .or(`new_data->>email.eq.${EMAIL},old_data->>email.eq.${EMAIL},new_data->>member_email.eq.${EMAIL}`)
    .order("created_at", { ascending: true });

  if (auErr) console.error("Audit log query error:", auErr);
  if (!audits?.length) {
    console.log("  NO audit log entries found.");
  } else {
    for (const a of audits) {
      console.log(`  Audit id=${a.id}, action=${a.action}`);
      console.log(`    created_at: ${ts(a.created_at)}`);
      console.log(`    details: ${JSON.stringify(a.details)}`);
      console.log();
    }
  }

  // 6. Razorpay payment details
  console.log("--- 6. RAZORPAY PAYMENT DETAILS ---");
  try {
    const rzpPayment = await razorpay.payments.fetch(PAYMENT_ID);
    console.log(`  Payment ID:    ${rzpPayment.id}`);
    console.log(`  Order ID:      ${rzpPayment.order_id}`);
    console.log(`  Amount:        ${rzpPayment.amount} paise (₹${rzpPayment.amount / 100})`);
    console.log(`  Status:        ${rzpPayment.status}`);
    console.log(`  Method:        ${rzpPayment.method}`);
    console.log(`  Email:         ${rzpPayment.email}`);
    console.log(`  Contact:       ${rzpPayment.contact}`);
    console.log(`  Created at:    ${ts(new Date(rzpPayment.created_at * 1000).toISOString())}`);
    if (rzpPayment.captured) {
      console.log(`  Captured:      YES`);
    }
    console.log(`  Description:   ${rzpPayment.description}`);
    console.log(`  Notes:         ${JSON.stringify(rzpPayment.notes)}`);
    console.log(`  Fee:           ${rzpPayment.fee} paise`);
    console.log(`  Tax:           ${rzpPayment.tax} paise`);
    console.log(`  Error code:    ${rzpPayment.error_code || "(none)"}`);
    console.log(`  Error desc:    ${rzpPayment.error_description || "(none)"}`);

    // Also fetch order
    console.log("\n--- 6b. RAZORPAY ORDER DETAILS ---");
    const rzpOrder = await razorpay.orders.fetch(ORDER_ID);
    console.log(`  Order ID:      ${rzpOrder.id}`);
    console.log(`  Amount:        ${rzpOrder.amount} paise (₹${rzpOrder.amount / 100})`);
    console.log(`  Status:        ${rzpOrder.status}`);
    console.log(`  Created at:    ${ts(new Date(rzpOrder.created_at * 1000).toISOString())}`);
    console.log(`  Notes:         ${JSON.stringify(rzpOrder.notes)}`);
    console.log(`  Attempts:      ${rzpOrder.attempts}`);
  } catch (e) {
    console.error("  Razorpay fetch error:", e.message);
  }

  // 7. TIMELINE & ANALYSIS
  console.log("\n" + "=".repeat(70));
  console.log("TIMELINE & ROOT CAUSE ANALYSIS");
  console.log("=".repeat(70));

  const verifiedOtps = (otps || []).filter(o => o.verified);
  const latestVerifiedOtp = verifiedOtps.length ? verifiedOtps[verifiedOtps.length - 1] : null;
  const draft = drafts?.length ? drafts[0] : null;

  if (latestVerifiedOtp) {
    // OTP verification creates a JWT with 1h expiry
    const otpVerifiedAt = latestVerifiedOtp.created_at; // OTP created, verified shortly after
    const jwtExpiresAt = new Date(new Date(otpVerifiedAt).getTime() + 60 * 60 * 1000).toISOString();

    console.log(`\n  OTP verified (approx):   ${ts(otpVerifiedAt)}`);
    console.log(`  JWT expires at:          ${ts(jwtExpiresAt)}`);

    // Razorpay payment created_at
    try {
      const rzpPayment = await razorpay.payments.fetch(PAYMENT_ID);
      const paymentTime = new Date(rzpPayment.created_at * 1000).toISOString();
      console.log(`  Razorpay payment time:   ${ts(paymentTime)}`);

      const minutesOtpToPayment = diffMinutes(otpVerifiedAt, paymentTime);
      console.log(`\n  Time OTP -> Payment:     ${minutesOtpToPayment} minutes`);

      if (parseFloat(minutesOtpToPayment) > 60) {
        console.log(`  >>> JWT EXPIRED before payment! (${minutesOtpToPayment} min > 60 min)`);
        console.log(`  >>> The submit API call after payment would have been rejected with 401.`);
      } else {
        console.log(`  >>> JWT was still valid at payment time.`);
        // Check if payment was before draft updated
        if (draft) {
          const minutesPaymentToDraft = diffMinutes(paymentTime, draft.updated_at);
          console.log(`  Time Payment -> Draft updated: ${minutesPaymentToDraft} minutes`);
        }
      }
    } catch (e) {
      console.error("  Could not fetch Razorpay for timeline:", e.message);
    }
  } else {
    console.log("  No verified OTP found — cannot compute timeline.");
  }

  if (draft) {
    console.log(`\n  Draft status:    ${draft.status}`);
    console.log(`  Draft step:      ${draft.current_step}`);
    console.log(`  Draft has payment info: order=${draft.payment_order_id || "NONE"}, id=${draft.payment_id || "NONE"}`);
    console.log(`  Draft verified payment: ${draft.has_verified_payment}`);

    if (!draft.payment_order_id && !draft.payment_id) {
      console.log(`\n  >>> Draft has NO payment info — payment callback never updated the draft.`);
      console.log(`  >>> This means the client-side flow broke AFTER Razorpay collected money`);
      console.log(`  >>> but BEFORE the verify-payment API was called (or it failed silently).`);
    }
  }

  console.log("\n" + "=".repeat(70));
}

main().catch(console.error);
