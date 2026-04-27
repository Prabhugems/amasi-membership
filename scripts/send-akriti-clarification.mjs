#!/usr/bin/env node
// One-off: ask Dr. Akriti Gupta Gupta to re-upload MCI + PG cert.
// Mirrors /api/applications/clarification: status -> need_clarification, sends Resend email, writes admin_audit_log.

import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { readFileSync } from "node:fs"

// Load .env.local manually (no next runtime here)
const envText = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
}

const APPLICATION_ID = "c0147679-081b-4d1d-ab98-c2f3014bf874"
const REFERENCE = "AMASI-2026-0B9B910525"
const TO_EMAIL = "akritigupta211293@gmail.com"
const ADMIN_EMAIL = "admin@amasi.org"
const ADMIN_NAME = "AMASI Admin"

const MESSAGE = `Thank you for your AMASI Associate Life Member application and payment. Your profile photo was received successfully, but unfortunately your MCI/State Medical Council Certificate and PG Degree Certificate did not upload due to a network interruption — our system shows them as failed.

Please re-upload clearer scans/photos of these two documents (PDFs or well-lit phone photos work). Click the Update Application button below to continue.

Your payment of ₹4,230 is fully credited and you will not be charged again.

If you continue to face upload issues, reply to this email or write to membership@amasi.org and we will attach the documents for you.`

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)
const resend = new Resend(process.env.RESEND_API_KEY)

const { data: app, error: fetchErr } = await supabase
  .from("membership_applications")
  .select("id, email, reference_number, status, salutation, first_name, name, last_name, middle_name")
  .eq("id", APPLICATION_ID)
  .single()
if (fetchErr || !app) { console.error("Fetch failed:", fetchErr); process.exit(1) }
if (["approved", "ai_approved", "rejected"].includes(app.status)) {
  console.error(`Refusing to act — status is ${app.status}`); process.exit(1)
}
if (app.email !== TO_EMAIL) { console.error("Email mismatch — aborting"); process.exit(1) }

console.log(`Found application ${app.reference_number} (status=${app.status}). Proceeding.`)

const { error: updErr } = await supabase
  .from("membership_applications")
  .update({
    status: "need_clarification",
    review_notes: MESSAGE,
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  .eq("id", APPLICATION_ID)
if (updErr) { console.error("Update failed:", updErr); process.exit(1) }
console.log("✓ Status updated to need_clarification")

const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://application.amasi.org"
const resubmitLink = `${appUrl}/apply/resubmit?ref=${app.reference_number}`
const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"
const greeting = `${escapeHtml(app.salutation || "Dr.")} ${escapeHtml(app.first_name || app.name || "")}`.trim()

const html = `
  <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
    <h2 style="color: #1a1a1a;">Additional Information Required</h2>
    <p style="color: #555;">Dear ${greeting},</p>
    <p style="color: #555;">We need additional information regarding your application.</p>
    <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <p style="color: #1e40af; font-weight: bold; margin: 0;">Message from reviewer</p>
      <p style="color: #1e40af; font-size: 14px; margin: 4px 0 0; white-space: pre-line;">${escapeHtml(MESSAGE)}</p>
    </div>
    <p style="color: #555;">Please click the link below to review and update your application:</p>
    <p style="text-align: center; margin: 24px 0;">
      <a href="${resubmitLink}" style="display: inline-block; background: #2563eb; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold;">Update Application</a>
    </p>
    <p style="color: #888; font-size: 13px;">If the button above doesn't work, copy and paste this link into your browser:<br /><a href="${resubmitLink}" style="color: #2563eb;">${resubmitLink}</a></p>
    <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
    <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
  </div>
`

const { data: emailRes, error: emailErr } = await resend.emails.send({
  from: fromEmail,
  to: TO_EMAIL,
  subject: `AMASI Application — Action Required — ${app.reference_number}`,
  html,
})
if (emailErr) { console.error("Email failed:", emailErr); process.exit(1) }
console.log(`✓ Email sent (id=${emailRes?.id})`)

const fullName = [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") || app.name
const { error: auditErr } = await supabase.from("admin_audit_log").insert({
  admin_email: ADMIN_EMAIL,
  admin_name: ADMIN_NAME,
  action: "request_clarification",
  entity_type: "application",
  entity_id: APPLICATION_ID,
  entity_name: fullName,
  details: { action: "need_clarification", message: MESSAGE, channel: "manual_script" },
})
if (auditErr) console.error("Audit log failed (non-fatal):", auditErr)
else console.log("✓ Audit log written")

console.log("\nDone.")
