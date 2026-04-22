import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };

const supabase = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"));
const resend = new Resend(getEnv("RESEND_API_KEY"));
const fromEmail = getEnv("RESEND_FROM_EMAIL") || "AMASI <noreply@amasi.org>";
const baseUrl = "https://membership.amasi.org";

// Get 100 newest members missing PG degree with real emails
const { data: members } = await supabase
  .from("members")
  .select("amasi_number, name, email, pg_degree, profile_photo, membership_type")
  .is("pg_degree", null)
  .not("email", "like", "noemail-%")
  .order("amasi_number", { ascending: false })
  .limit(100);

console.log(`Sending profile update emails to ${members.length} members...\n`);

let sent = 0, failed = 0;

for (const m of members) {
  const name = m.name || "Member";
  const firstName = name.split(" ")[0];

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px;">Dear Dr. ${firstName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          We are updating our membership records and noticed that your profile is incomplete.
          Your AMASI membership number is <strong>#${m.amasi_number}</strong>.
        </p>
        <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="color: #92400e; font-weight: bold; margin: 0 0 8px;">Please update the following:</p>
          <ol style="color: #92400e; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>PG Degree &amp; Specialisation</li>
            <li>Profile Photo (passport-size)</li>
            <li>Date of Birth</li>
            <li>Contact Number</li>
            <li>Address Details</li>
          </ol>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          An updated profile ensures you receive your digital membership card, certificate,
          and are eligible for AMASI events and courses like FMAS.
        </p>
        <div style="text-align: center; margin: 28px 0 16px;">
          <a href="${baseUrl}/member"
             style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Update My Profile
          </a>
        </div>
        <p style="color: #555; font-size: 13px;">
          Log in with your registered email <strong>${m.email}</strong> and verify via OTP.
        </p>
        <p style="color: #555; font-size: 13px;">If you have questions, contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
      </div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: fromEmail,
      to: m.email,
      subject: `AMASI Member #${m.amasi_number} — Please Update Your Profile`,
      html,
    });
    sent++;
    if (sent % 10 === 0) console.log(`Progress: ${sent}/${members.length}`);
  } catch (e) {
    failed++;
    console.log(`Failed: #${m.amasi_number} ${m.email}: ${e.message}`);
  }

  // Small delay to avoid rate limits
  if (sent % 10 === 0) await new Promise(r => setTimeout(r, 1000));
}

// Log to campaign_logs table (create if not exists)
try {
  await supabase.from("membership_audit_log").insert({
    action: "campaign_sent",
    target_type: "members",
    target_id: "profile_update_batch_1",
    details: {
      campaign: "Profile Update — Missing PG Degree",
      total: members.length,
      sent,
      failed,
      date: new Date().toISOString(),
      amasi_range: `${members[members.length-1]?.amasi_number} to ${members[0]?.amasi_number}`,
    },
    performed_by: "system",
  });
} catch {}

console.log(`\n=== DONE ===`);
console.log(`Sent: ${sent}`);
console.log(`Failed: ${failed}`);
console.log(`Range: #${members[members.length-1]?.amasi_number} to #${members[0]?.amasi_number}`);
