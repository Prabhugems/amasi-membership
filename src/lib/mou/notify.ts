import { Resend } from "resend"
import { sendTemplate } from "@/lib/whatsapp"
import type { AcademicEventApplication } from "./types"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

const FROM = "AMASI <noreply@amasi.org>"

// rejection_reason (passed in explicitly by the decide route, see
// sendOutcomeEmail below), organizer_name, and primary_institution are all
// free text supplied by an anonymous, unauthenticated applicant (POST
// /api/mou/applications) or a decide-capable magic-link holder (the Hon.
// Secretary), and are interpolated straight into outbound HTML emails.
// Escape them so none of them can break out of the surrounding markup
// (e.g. inject a <script> or rewrite a visible link).
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

// Same fallback pattern used throughout this codebase (e.g.
// src/app/api/mou/applications/route.ts, src/app/api/tickets/route.ts) for
// building absolute links inside outbound emails.
function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"
}

function statusLinkUrl(application: AcademicEventApplication): string {
  return `${appUrl()}/mou/status/${application.id}`
}

// FYI recipients (President, zone chairs) are notified purely by role slug
// (see academic_event_role_assignments.role / the zone_chair_<zone> lookup
// in src/app/api/mou/applications/route.ts) — without this, the email body
// never told the recipient *why* they were CC'd, e.g. a South Zone chair had
// no way to tell from the email itself that they were the South Zone chair,
// only that they'd received a random FYI. Falls back to a readable version
// of the raw slug for any role not in this map, rather than silently
// omitting the sentence for a role this map hasn't been updated for.
const ROLE_LABELS: Record<string, string> = {
  president: "AMASI President",
  zone_chair_north: "North Zone Chair",
  zone_chair_south: "South Zone Chair",
  zone_chair_east: "East Zone Chair",
  zone_chair_west: "West Zone Chair",
  zone_chair_central: "Central Zone Chair",
  director_fmas: "National Director, FMAS Academics",
  director_nextgen: "National Director, NextGen",
  director_slcp: "National Director, SLCP",
  director_nextgen_associate_1: "Associate Director, NextGen",
  director_nextgen_associate_2: "Associate Director, NextGen",
  director_slcp_assistant: "Assistant Director, SLCP",
}

function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ")
}

// Shared branded wrapper for every MOU email — was previously bare <p> tags
// with no header, footer, or visual hierarchy at all. Inline styles only
// (no <style> block, no flexbox/grid) for compatibility with clients that
// strip <head> or ignore modern CSS, e.g. Outlook desktop. Teal (#0f766e)
// matches --primary in src/app/globals.css; the amber used for FMAS/MMAS
// credential emails (src/lib/fmas-cert-email.ts) is that feature's own
// sub-brand and intentionally not reused here.
function emailShell(opts: {
  heading: string
  bodyHtml: string
  cta?: { label: string; url: string }
  footerNote?: string
}): string {
  const ctaHtml = opts.cta
    ? `<p style="margin:28px 0 8px;">
        <a href="${opts.cta.url}" style="background:#0f766e;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">
          ${opts.cta.label}
        </a>
      </p>
      <p style="margin:0 0 24px;color:#94a3b8;font-size:12px;word-break:break-all;">
        Or paste this link: <a href="${opts.cta.url}" style="color:#0f766e;">${opts.cta.url}</a>
      </p>`
    : ""
  const footerNoteHtml = opts.footerNote
    ? `<p style="margin:0 0 16px;color:#64748b;font-size:13px;">${opts.footerNote}</p>`
    : ""
  return `
<div style="background:#f8fafc;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
    <div style="margin:0 0 24px;">
      <span style="font-size:11px;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#94a3b8;">
        Association of Minimal Access Surgeons of India
      </span>
    </div>
    <h2 style="margin:0 0 16px;color:#0f172a;font-size:20px;font-weight:700;">${opts.heading}</h2>
    <div style="color:#334155;font-size:14px;line-height:1.6;">${opts.bodyHtml}</div>
    ${ctaHtml}
    ${footerNoteHtml}
    <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;" />
    <p style="margin:0;color:#94a3b8;font-size:11px;text-align:center;">
      AMASI &middot; <a href="mailto:amasi.india@gmail.com" style="color:#94a3b8;">amasi.india@gmail.com</a> &middot; www.amasi.org
    </p>
  </div>
</div>`
}

export async function sendApplicantConfirmation(application: AcademicEventApplication, confirmationNote?: string): Promise<void> {
  const organizerName = escapeHtml(application.organizer_name)
  const noteHtml = confirmationNote
    ? `<div style="margin:16px 0;padding:12px 16px;background:#f0fdfa;border-left:3px solid #0f766e;border-radius:4px;color:#0f172a;font-size:13px;">${escapeHtml(confirmationNote)}</div>`
    : ""
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: "AMASI application received",
    html: emailShell({
      heading: "Application received",
      bodyHtml: `<p style="margin:0 0 12px;">Dear ${organizerName},</p>
        <p style="margin:0 0 12px;">Your application (ID ${application.id}) has been received and is under review by the AMASI Hon. Secretary. You'll be notified by email once a decision is made.</p>
        ${noteHtml}`,
      cta: { label: "Check application status", url: statusLinkUrl(application) },
    }),
  })
}

export async function sendSecretaryApprovalRequest(
  application: AcademicEventApplication,
  typeLabel: string,
  secretaryEmail: string,
  magicLinkUrl: string
): Promise<void> {
  const organizerName = escapeHtml(application.organizer_name)
  const primaryInstitution = escapeHtml(application.primary_institution)
  await getResend().emails.send({
    from: FROM,
    to: secretaryEmail,
    subject: `Application for review: ${typeLabel} — ${application.organizer_name}`,
    html: emailShell({
      heading: "Application awaiting your decision",
      bodyHtml: `<p style="margin:0;">A new <strong>${escapeHtml(typeLabel)}</strong> application from <strong>${organizerName}</strong> (${primaryInstitution}) needs your decision.</p>`,
      cta: { label: "Review and decide", url: magicLinkUrl },
      footerNote: "This link is unique to you — please don't forward it.",
    }),
  })
}

export async function sendFyiNotification(
  application: AcademicEventApplication,
  typeLabel: string,
  recipientEmail: string,
  recipientRole: string,
  viewLinkUrl: string
): Promise<void> {
  const organizerName = escapeHtml(application.organizer_name)
  await getResend().emails.send({
    from: FROM,
    to: recipientEmail,
    subject: `FYI: ${typeLabel} application from ${application.organizer_name}`,
    html: emailShell({
      heading: "For your information",
      bodyHtml: `<p style="margin:0 0 12px;">A new <strong>${escapeHtml(typeLabel)}</strong> application from <strong>${organizerName}</strong> has been submitted and is awaiting the Hon. Secretary's decision. This is for your information only — no action is needed from you.</p>
        <p style="margin:0;color:#64748b;font-size:13px;">You're receiving this as the ${escapeHtml(roleLabel(recipientRole))}.</p>`,
      cta: { label: "View application and leave a remark", url: viewLinkUrl },
    }),
  })
}

export async function sendOutcomeEmail(
  application: AcademicEventApplication,
  typeLabel: string,
  outcome: "approved" | "rejected" | "changes_requested",
  rejectionReason?: string | null,
  mouPdfBuffer?: Buffer
): Promise<void> {
  const subjectByOutcome = {
    approved: `Your ${typeLabel} application has been approved`,
    rejected: `Your ${typeLabel} application was not approved`,
    changes_requested: `Changes requested on your ${typeLabel} application`,
  }
  const headingByOutcome = {
    approved: "Application approved",
    rejected: "Application not approved",
    changes_requested: "Changes requested",
  }
  const organizerName = escapeHtml(application.organizer_name)
  const safeRejectionReason = rejectionReason ? escapeHtml(rejectionReason) : null
  const reasonBlock = safeRejectionReason
    ? `<div style="margin:16px 0;padding:12px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:4px;color:#0f172a;font-size:13px;">${safeRejectionReason}</div>`
    : ""
  const nextStepsLine =
    `<p style="margin:16px 0 0;">There is no resubmission flow at this time. If you have questions, please contact the AMASI Secretary` +
    ` at <a href="mailto:amasi.india@gmail.com" style="color:#0f766e;">amasi.india@gmail.com</a>.</p>`
  const bodyByOutcome = {
    approved: `<p style="margin:0 0 12px;">Dear ${organizerName},</p><p style="margin:0;">Congratulations — your application has been approved. The signed MOU is attached to this email.</p>`,
    rejected: `<p style="margin:0 0 12px;">Dear ${organizerName},</p><p style="margin:0;">Your application was not approved.</p>${reasonBlock}${nextStepsLine}`,
    changes_requested: `<p style="margin:0 0 12px;">Dear ${organizerName},</p><p style="margin:0;">The Hon. Secretary has requested changes.</p>${reasonBlock}${nextStepsLine}`,
  }
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: subjectByOutcome[outcome],
    html: emailShell({
      heading: headingByOutcome[outcome],
      bodyHtml: bodyByOutcome[outcome],
      cta: { label: "Check application status", url: statusLinkUrl(application) },
    }),
    ...(mouPdfBuffer
      ? { attachments: [{ filename: `MOU-${application.id}.pdf`, content: mouPdfBuffer.toString("base64") }] }
      : {}),
  })
}

export async function sendWhatsAppNudge(
  application: AcademicEventApplication,
  outcome: "approved" | "rejected" | "changes_requested"
): Promise<void> {
  // sendTemplate requires a pre-approved GallaBox template. Template name
  // "mou_application_outcome" must exist in the GallaBox dashboard before
  // this fires in production — if it doesn't, sendTemplate returns
  // {success:false} rather than throwing, so this never blocks the rest
  // of the approval chain.
  await sendTemplate(String(application.phone_number), application.organizer_name, "mou_application_outcome", {
    outcome,
  })
}
