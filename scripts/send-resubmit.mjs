import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const resend = new Resend(getEnv("RESEND_API_KEY"));
const fromEmail = getEnv("RESEND_FROM_EMAIL") || "AMASI <noreply@amasi.org>";
const baseUrl = "https://membership.amasi.org";

// Get all pending applications
const { data: apps } = await supabase
  .from("membership_applications")
  .select("id, name, email, reference_number")
  .in("status", ["pending_review", "submitted"])
  .order("created_at", { ascending: false });

console.log(`Found ${apps.length} pending applications\n`);

for (const app of apps) {
  const ref = app.reference_number;

  // Update status
  await supabase.from("membership_applications").update({
    status: "resubmit_requested",
    review_notes: "Documents required: MCI Certificate, PG Degree Certificate, Profile Photo. Applicant was asked to re-upload via email.",
    reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", app.id);

  // Send email
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px;">Dear ${app.name},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          Thank you for your AMASI membership application (<strong>${ref}</strong>).
          To complete the verification process, we need you to re-upload the following:
        </p>
        <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="color: #92400e; font-weight: bold; margin: 0 0 8px;">Documents Required:</p>
          <ol style="color: #92400e; font-size: 14px; margin: 0; padding-left: 20px;">
            <li>MCI / State Medical Council Certificate</li>
            <li>PG Degree Certificate (MS/MD/MCh/DNB)</li>
            <li>Profile Photo (passport-size, plain background)</li>
          </ol>
        </div>
        <p style="color: #555; font-size: 14px;">Your application details and payment are safe. You will <strong>not</strong> be charged again.</p>
        <div style="text-align: center; margin: 28px 0 16px;">
          <a href="${baseUrl}/apply/resubmit?ref=${ref}&email=${encodeURIComponent(app.email)}"
             style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Upload Documents
          </a>
        </div>
        <p style="color: #555; font-size: 13px;">If you have questions, contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
      </div>
    </div>
  `;

  try {
    const { data: emailResult } = await resend.emails.send({
      from: fromEmail,
      to: app.email,
      subject: `AMASI Application — Documents & Photo Required (${ref})`,
      html,
    });
    console.log(`${app.name} (${app.email}): Email sent (${emailResult?.id})`);
  } catch (e) {
    console.log(`${app.name}: Email FAILED — ${e.message}`);
  }

  // Audit log
  await supabase.from("membership_audit_log").insert({
    action: "resubmit_requested",
    target_type: "application",
    target_id: app.id,
    details: { email: app.email, reason: "Documents not stored — uploaded before file storage was enabled" },
    performed_by: "system",
  });
}

console.log("\nDone!");
