import { Resend } from "resend";
import { readFileSync } from "fs";
const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => { const re = new RegExp(k + '=["\']?([^"\'\\n]+)'); const m = env.match(re); return m?.[1]?.trim(); };
const resend = new Resend(getEnv("RESEND_API_KEY"));

const { data } = await resend.emails.send({
  from: getEnv("RESEND_FROM_EMAIL") || "AMASI <noreply@amasi.org>",
  to: "krkaushik22@gmail.com",
  subject: "Action Required: Complete your AMASI membership application",
  html: `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px;">Dear Dr. Kumar Kaushik,</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          We received your payment of &#8377;4,230 for your Life Member (LM) application (Ref: AMASI-2026-F1A29BDA64).
          However, due to a technical issue, your application details were not saved.
        </p>
        <div style="background: #d1fae5; border: 1px solid #6ee7b7; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="color: #065f46; font-weight: bold; margin: 0;">Your payment is safe and fully recorded. You will NOT be charged again.</p>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          Please click the button below to complete your application. You will need to verify your email and re-upload your documents. The payment step will be automatically skipped.
        </p>
        <div style="text-align: center; margin: 28px 0 16px;">
          <a href="https://membership.amasi.org/apply"
             style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Complete Your Application
          </a>
        </div>
        <p style="color: #555; font-size: 13px;">If you have questions, contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
      </div>
    </div>
  `,
});
console.log("Email sent:", data?.id);
