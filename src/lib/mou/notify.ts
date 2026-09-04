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

export async function sendApplicantConfirmation(application: AcademicEventApplication, confirmationNote?: string): Promise<void> {
  const organizerName = escapeHtml(application.organizer_name)
  const noteHtml = confirmationNote ? `<p>${escapeHtml(confirmationNote)}</p>` : ""
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: "AMASI application received",
    html: `<p>Dear ${organizerName},</p>
      <p>Your application (ID ${application.id}) has been received and is under review by the AMASI Hon. Secretary.
      You'll be notified by email once a decision is made.</p>
      ${noteHtml}
      <p>You can check the status of your application at any time here:
      <a href="${statusLinkUrl(application)}">${statusLinkUrl(application)}</a></p>`,
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
    html: `<p>A new ${typeLabel} application from ${organizerName} (${primaryInstitution})
      needs your decision.</p>
      <p><a href="${magicLinkUrl}">Review and decide</a></p>`,
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
    html: `<p>A new ${typeLabel} application from ${organizerName} has been submitted and is
      awaiting the Hon. Secretary's decision. This is for your information only — no action is needed from you.</p>
      <p><a href="${viewLinkUrl}">View application and leave a remark</a></p>`,
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
  const organizerName = escapeHtml(application.organizer_name)
  const safeRejectionReason = rejectionReason ? escapeHtml(rejectionReason) : null
  const nextStepsLine =
    `<p>There is no resubmission flow at this time. If you have questions, please contact the AMASI Secretary` +
    ` at <a href="mailto:amasi.india@gmail.com">amasi.india@gmail.com</a>.</p>`
  const statusLine = `<p>You can check the status of your application at any time here:
      <a href="${statusLinkUrl(application)}">${statusLinkUrl(application)}</a></p>`
  const bodyByOutcome = {
    approved: `<p>Congratulations — your application has been approved. The signed MOU is attached.</p>${statusLine}`,
    rejected: `<p>Your application was not approved.${safeRejectionReason ? ` Reason: ${safeRejectionReason}` : ""}</p>${nextStepsLine}${statusLine}`,
    changes_requested: `<p>The Hon. Secretary has requested changes.${safeRejectionReason ? ` Details: ${safeRejectionReason}` : ""}</p>${nextStepsLine}${statusLine}`,
  }
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: subjectByOutcome[outcome],
    html: `<p>Dear ${organizerName},</p>${bodyByOutcome[outcome]}`,
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
