import type { TemplateEntry } from "../types"
import { escapeHtml } from "@/lib/html-escape"

export const profileUpdateMissingPgDegree: TemplateEntry = {
  key: "profile_update_missing_pg_degree",
  name: "Profile Update — Missing PG Degree",
  category: "marketing",
  targetFields: ["pg_degree"],

  buildSegment: (q) =>
    q.is("pg_degree", null)
      .not("email", "like", "noemail-%")
      .order("amasi_number", { ascending: false }),

  subject: (m) => `AMASI Member #${m.amasi_number} — Please Update Your Profile`,

  html: (m, { baseUrl, autoLoginToken }) => {
    const rawName = m.name || "Member"
    const safeName = escapeHtml(rawName)
    const safeEmail = escapeHtml(m.email)
    const amasi = escapeHtml(String(m.amasi_number))
    // With token: one click signs them in and drops them on the upload tab.
    // Without (token mint failed): plain /m → /member → OTP, same end state.
    const ctaUrl = autoLoginToken
      ? `${baseUrl}/m?t=${encodeURIComponent(autoLoginToken)}`
      : `${baseUrl}/m`
    return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px;">Dear Dr. ${safeName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          We are updating our membership records and noticed that your profile is incomplete.
          Your AMASI membership number is <strong>#${amasi}</strong>.
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
        <div style="text-align: center; margin: 28px 0 16px;">
          <a href="${ctaUrl}" style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">Update My Profile</a>
        </div>
        <p style="color: #555; font-size: 13px;">${autoLoginToken
          ? `One-click sign-in for <strong>${safeEmail}</strong> — link expires in 24 hours.`
          : `Log in with your registered email <strong>${safeEmail}</strong> and verify via OTP.`
        }</p>
        <p style="color: #555; font-size: 13px;">If you have questions, contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
      </div>
    </div>`
  },
}
