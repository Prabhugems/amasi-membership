import type { TemplateEntry } from "../types"
import { escapeHtml } from "@/lib/html-escape"

// Public URL of the notice image (PNG). Hosted in the Supabase `uploads`
// bucket (public=true) so email clients can fetch it directly. Fill this in
// once the screenshot is uploaded — see the campaigns README / handoff note.
// Until set, the email still conveys the full meeting details via the text
// block below, so a blank URL degrades gracefully rather than shipping a
// broken <img>.
const NOTICE_IMAGE_URL = ""

export const egmNotice20260617: TemplateEntry = {
  key: "egm_notice_2026_06_17",
  name: "Emergency General Body Meeting — 17 Jun 2026",
  // Statutory: a General Body Meeting notice is an official communication, so
  // it is sent to every member and is NOT subject to marketing opt-out.
  category: "statutory",
  targetFields: [],

  // All members with a real email. Mirror the SQL-expressible subset of
  // src/lib/email-exclusions.ts (test/internal addresses).
  buildSegment: (q) =>
    q
      .not("email", "is", null)
      .not("email", "like", "noemail-%")
      .not("email", "ilike", "noreply@%")
      .not("email", "ilike", "admin@%")
      .not("email", "ilike", "test@%")
      .not("email", "ilike", "collegeofamasi@%")
      .not("email", "ilike", "%@test.%")
      .order("amasi_number", { ascending: true }),

  subject: () =>
    "AMASI — Notice: Emergency General Body Meeting, Wed 17th June 2026, 8:00 PM IST",

  html: (m) => {
    const safeName = escapeHtml(m.name || "Member")
    // Lead with the notice image (what was requested). The text block beneath
    // repeats every detail so recipients whose client blocks remote images —
    // common default in Gmail/Outlook — still get the full notice.
    const imageBlock = NOTICE_IMAGE_URL
      ? `<div style="margin: 0 0 24px;">
          <img src="${NOTICE_IMAGE_URL}" alt="AMASI Notice — Emergency General Body Meeting, Wednesday 17th June 2026, 8:00 PM IST, Online" style="width: 100%; height: auto; display: block; border: 1px solid #e5e7eb; border-radius: 8px;" />
        </div>`
      : ""

    return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px; margin: 0 0 20px;">Dear Dr. ${safeName},</p>

        ${imageBlock}

        <p style="text-align: center; color: #111827; font-weight: bold; font-size: 16px; letter-spacing: 0.5px; margin: 0 0 20px;">EMERGENCY GENERAL BODY MEETING</p>

        <table role="presentation" cellpadding="0" cellspacing="0" style="width: 100%; font-size: 14px; color: #374151; line-height: 1.8; margin: 0 0 20px;">
          <tr><td style="padding: 2px 0; width: 90px; color: #6b7280;">Date</td><td style="padding: 2px 0;"><strong>Wednesday, 17th June 2026</strong></td></tr>
          <tr><td style="padding: 2px 0; color: #6b7280;">Time</td><td style="padding: 2px 0;"><strong>8:00 PM (IST)</strong></td></tr>
          <tr><td style="padding: 2px 0; color: #6b7280;">Venue</td><td style="padding: 2px 0;"><strong>Online</strong></td></tr>
        </table>

        <p style="color: #111827; font-weight: bold; font-size: 14px; margin: 0 0 8px;">AGENDA</p>
        <ol style="color: #374151; font-size: 14px; margin: 0 0 20px; padding-left: 20px; line-height: 1.8;">
          <li>Welcome Address — Dr. Kalpesh Jani</li>
          <li>To discuss the venue of AMASICON 2027</li>
          <li>Vote of Thanks</li>
        </ol>

        <p style="color: #374151; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">All members are requested to make it convenient to attend this important meeting.</p>

        <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; margin-top: 8px;">
          <p style="color: #374151; font-size: 14px; margin: 0;"><strong>Dr. Roshan Shetty</strong></p>
          <p style="color: #6b7280; font-size: 13px; margin: 2px 0 0;">Honorary Secretary, AMASI</p>
        </div>

        <p style="color: #6b7280; font-size: 13px; line-height: 1.6; margin: 24px 0 0; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px 14px;">
          <strong>Note:</strong> The online meeting link will be circulated through email and WhatsApp the day before the meeting.
        </p>

        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center; line-height: 1.6;">
          AMASI Head Office, 45 A, Pankaja Mill Rd, Ramanathapuram, Coimbatore<br />
          +91 422 4223330 &nbsp;·&nbsp; amasi.india@gmail.com &nbsp;·&nbsp; www.amasi.org
        </p>
      </div>
    </div>`
  },
}
