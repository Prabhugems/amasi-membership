/**
 * Transactional emails for event-hosting (MOU) applications.
 *
 * Same Resend + escapeHtml pattern as /api/tickets. Every value interpolated
 * into HTML is escaped; nothing from the applicant is used in a header.
 * Failures are logged and swallowed — an email outage must not fail the
 * submit or the admin decision.
 */
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"
import { MOU_EVENTS, MOU_STATUS_META, type MouEventType, type MouStatus } from "@/lib/mou-events"

interface MouEmailRow {
  id: string
  reference_number: string
  event_type: MouEventType
  applicant_name: string
  applicant_email: string
  place: string
  proposed_date: string | null
  proposed_year: number | null
}

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org").replace(/\/$/, "")
}

function adminRecipient(): string {
  return (
    process.env.ADMIN_NOTIFICATION_EMAIL ||
    process.env.ADMIN_DEFAULT_EMAIL ||
    process.env.ADMIN_EMAIL ||
    "admin@amasi.org"
  )
}

function fromAddress(): string {
  return process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"
}

function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) {
    console.error("[mou-emails] RESEND_API_KEY missing — email skipped")
    return null
  }
  return new Resend(key)
}

function whenText(row: MouEmailRow): string {
  if (row.proposed_year) return String(row.proposed_year)
  if (row.proposed_date) return row.proposed_date
  return "—"
}

function shell(title: string, body: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0f766e; margin: 0 0 16px;">${escapeHtml(title)}</h2>
      ${body}
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
      <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
    </div>
  `
}

function row(label: string, value: string): string {
  return `<tr><td style="padding: 6px 12px 6px 0; font-weight: bold; vertical-align: top;">${escapeHtml(label)}</td><td style="padding: 6px 0;">${escapeHtml(value)}</td></tr>`
}

export async function sendMouSubmittedEmails(app: MouEmailRow): Promise<void> {
  const resend = getResend()
  if (!resend) return
  const event = MOU_EVENTS[app.event_type]
  const adminUrl = `${baseUrl()}/admin/mou-applications?ref=${encodeURIComponent(app.reference_number)}`
  const memberUrl = `${baseUrl()}/mou/${event.slug}`

  const table = `
    <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #555;">
      ${row("Reference", app.reference_number)}
      ${row("Event", event.name)}
      ${row("Applicant", app.applicant_name)}
      ${row("Email", app.applicant_email)}
      ${row("Place", app.place)}
      ${row("Proposed", whenText(app))}
    </table>`

  try {
    await resend.emails.send({
      from: fromAddress(),
      to: adminRecipient(),
      subject: `[AMASI] New hosting application: ${event.shortName} — ${app.reference_number}`,
      html: shell(
        "New event hosting application",
        `${table}
        <p style="margin: 20px 0;"><a href="${adminUrl}" style="background: #0f766e; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">Review in admin</a></p>`
      ),
    })
  } catch (err) {
    console.error("[mou-emails] admin notification failed:", err)
  }

  try {
    await resend.emails.send({
      from: fromAddress(),
      to: app.applicant_email,
      subject: `AMASI — your application to host ${event.shortName} (${app.reference_number})`,
      html: shell(
        "Application received",
        `<p style="color: #334155;">Dear ${escapeHtml(app.applicant_name)},</p>
        <p style="color: #334155;">AMASI HQ has received your application to host <strong>${escapeHtml(event.name)}</strong> at ${escapeHtml(app.place)}.</p>
        ${table}
        <p style="color: #334155;">${escapeHtml(
          event.decidedBy === "gbm"
            ? "Valid AMASICON invitations are placed before the next General Body Meeting, where you will present your bid in person."
            : "The Executive Committee will consider your request. HQ normally completes processing within two weeks of a complete application."
        )}</p>
        <p style="color: #334155;">You can check the status any time at <a href="${memberUrl}">${memberUrl}</a>.</p>`
      ),
    })
  } catch (err) {
    console.error("[mou-emails] applicant confirmation failed:", err)
  }
}

export async function sendMouStatusEmail(
  app: MouEmailRow,
  status: MouStatus,
  note: string | null
): Promise<void> {
  const resend = getResend()
  if (!resend) return
  const event = MOU_EVENTS[app.event_type]
  const meta = MOU_STATUS_META[status]
  const memberUrl = `${baseUrl()}/mou/${event.slug}`

  const noteBlock = note
    ? `<div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
         <p style="color: #334155; margin: 0; white-space: pre-wrap;">${escapeHtml(note)}</p>
       </div>`
    : ""

  try {
    await resend.emails.send({
      from: fromAddress(),
      to: app.applicant_email,
      subject: `AMASI — ${event.shortName} application ${app.reference_number}: ${meta.label}`,
      html: shell(
        `Application ${meta.label}`,
        `<p style="color: #334155;">Dear ${escapeHtml(app.applicant_name)},</p>
        <p style="color: #334155;">Your application <strong>${escapeHtml(app.reference_number)}</strong> to host <strong>${escapeHtml(event.name)}</strong> at ${escapeHtml(app.place)} is now <strong>${escapeHtml(meta.label)}</strong>.</p>
        <p style="color: #334155;">${escapeHtml(meta.applicantText)}</p>
        ${noteBlock}
        <p style="color: #334155;">Details: <a href="${memberUrl}">${memberUrl}</a></p>`
      ),
    })
  } catch (err) {
    console.error("[mou-emails] status email failed:", err)
  }
}
