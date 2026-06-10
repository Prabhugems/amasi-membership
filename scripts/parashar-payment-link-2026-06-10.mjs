// One-shot: create a Razorpay payment link for Dr. Hemlata Parashar
//
// Context: Indian Obs&Gyn applicant; ALM tier ₹4230 (₹4130 base + ₹100 processing).
// Stuck at step 4 (applicant_idle_step_4) on draft c18b4393-0d77-4641-b353-a68b63a1626f
// since 2026-06-05. Docs already uploaded in her own /apply session (MCI 11991 MP +
// PG MS Obs&Gyn Jiwaji 1996 + profile photo) — the draft's step_data has full
// formData and the cert images live in uploads/ storage, so the post-payment
// backfill reuses those file URLs instead of re-uploading.
//
// Name decision: certificate uses the married surname (Parashar) to match the
// email she registered with (dr.hemlataparashar@gmail.com). Her MCI cert is the
// name-change additional registration that explicitly documents Batham → Parashar.
//
// Idempotency: writes the new payment_link id+url into stdout. Re-running creates
// a NEW link — Razorpay has no by-reference_id lookup. DO NOT re-run unless the
// first link expired or was cancelled.

import Razorpay from "razorpay"
import { readFileSync } from "fs"
import { randomBytes } from "node:crypto"

// Read Razorpay keys from .env.production.local (pulled via `vercel env pull --environment=production`).
// .env.local doesn't carry the live keys.
const env = readFileSync("/Users/prabhubalasubramaniam/amasi-membership/.env.production.local", "utf8")
const getEnv = (k) => {
  if (process.env[k]) return process.env[k]
  const re = new RegExp(k + '=["\']?([^"\'\\n]+)')
  const m = env.match(re)
  return m?.[1]?.trim()
}

const keyId = getEnv("RAZORPAY_KEY_ID")
const keySecret = getEnv("RAZORPAY_KEY_SECRET")
if (!keyId || !keySecret) throw new Error("missing RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET")

const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret })

const REFERENCE_ID = "AMASI-2026-PARASHAR-" + randomBytes(4).toString("hex").toUpperCase()
const AMOUNT_INR = 4230
const AMOUNT_PAISE = AMOUNT_INR * 100

const payload = {
  amount: AMOUNT_PAISE,
  currency: "INR",
  accept_partial: false,
  description: "AMASI Associate Life Member — Dr. Hemlata Parashar — ₹4230 (₹4130 + ₹100 processing)",
  customer: {
    name: "Dr. Hemlata Parashar",
    email: "dr.hemlataparashar@gmail.com",
    contact: "+917987284712",
  },
  // Notifications OFF — admin will share the URL via WhatsApp directly.
  // Razorpay reminders also disabled so we don't double-message.
  notify: { sms: false, email: false },
  reminder_enable: false,
  reference_id: REFERENCE_ID,
  notes: {
    membership_type: "ALM",
    applicant_country: "India",
    mci_council_number: "11991",
    mci_council_state: "Madhya Pradesh",
    pg_qualification: "M.S. Obstetrics & Gynaecology, Jiwaji University Gwalior, 1996",
    draft_id: "c18b4393-0d77-4641-b353-a68b63a1626f",
    name_note: "Married name Parashar (maiden Batham). MCI cert is name-change additional registration.",
    created_by: "admin (Prabhu via Claude Code)",
    created_at: new Date().toISOString(),
    reason: "Applicant idle at step 4 since 2026-06-05; admin sending payment link to unblock.",
  },
  callback_url: "https://membership.amasi.org/apply",
  callback_method: "get",
}

console.log("\n========== CREATE RAZORPAY PAYMENT LINK ==========")
console.log(`Reference: ${REFERENCE_ID}`)
console.log(`Amount:    ₹${AMOUNT_INR} (${AMOUNT_PAISE} paise)`)
console.log(`Customer:  ${payload.customer.name} <${payload.customer.email}>`)
console.log(`Phone:     ${payload.customer.contact}`)
console.log("Creating...\n")

const link = await rzp.paymentLink.create(payload)

console.log("✓ Payment link created\n")
console.log(`Link ID:     ${link.id}`)
console.log(`Reference:   ${link.reference_id}`)
console.log(`Status:      ${link.status}`)
console.log(`Amount:      ₹${link.amount / 100} ${link.currency}`)
console.log(`Short URL:   ${link.short_url}`)
console.log(`Expires:     ${link.expire_by ? new Date(link.expire_by * 1000).toISOString() : "no expiry"}`)
console.log("\n--- SHARE THIS URL WITH HEMLATA ---")
console.log(link.short_url)
console.log("\nNotifications are OFF — share this URL with Hemlata via WhatsApp manually.")
console.log("Once she pays, run scripts/parashar-backfill-2026-06-10.mjs to file her application.")
