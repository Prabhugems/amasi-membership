import { Resend } from "resend";
import { readFileSync } from "fs";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };

const resend = new Resend(getEnv("RESEND_API_KEY"));
const fromEmail = getEnv("RESEND_FROM_EMAIL") || "AMASI <noreply@amasi.org>";
const baseUrl = "https://membership.amasi.org";

const members = [
  { name: "Dr. Vineeth Kumar R K", email: "vineeth.kumar.rk@gmail.com", amasi: 18256, type: "Life Member" },
  { name: "Dr. Chandra Nath Saha", email: "chandranathsaha902@gmail.com", amasi: 18257, type: "Associate Life Member" },
];

for (const m of members) {
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px;">Dear ${m.name},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          Congratulations! Your AMASI membership has been approved.
        </p>
        <div style="background: #d1fae5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 16px; margin: 20px 0; text-align: center;">
          <p style="color: #065f46; font-weight: bold; margin: 0; font-size: 16px;">AMASI Membership Number</p>
          <p style="color: #065f46; font-size: 28px; font-weight: bold; margin: 8px 0 4px; letter-spacing: 2px;">${m.amasi}</p>
          <p style="color: #065f46; font-size: 13px; margin: 0;">${m.type}</p>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          Please take a moment to complete your profile by uploading the following:
        </p>
        <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="color: #92400e; font-weight: bold; margin: 0 0 8px;">Action Required — Update Your Profile:</p>
          <ol style="color: #92400e; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>Profile Photo (passport-size, plain background)</li>
            <li>MCI / State Medical Council Certificate</li>
            <li>PG Degree Certificate</li>
            <li>Verify your personal details (address, phone, etc.)</li>
          </ol>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          You can log in to your member profile using your registered email and OTP verification.
        </p>
        <div style="text-align: center; margin: 28px 0 16px;">
          <a href="${baseUrl}/member"
             style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Update My Profile
          </a>
        </div>
        <p style="color: #555; font-size: 13px;">You can also view your digital membership card and certificate from your profile.</p>
        <p style="color: #555; font-size: 13px;">If you have questions, contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
      </div>
    </div>
  `;

  try {
    const { data } = await resend.emails.send({
      from: fromEmail,
      to: m.email,
      subject: `Welcome to AMASI — Member #${m.amasi} — Please Update Your Profile`,
      html,
    });
    console.log(`${m.name} (${m.email}): Sent (${data?.id})`);
  } catch (e) {
    console.log(`${m.name}: FAILED — ${e.message}`);
  }
}

console.log("\nDone!");
