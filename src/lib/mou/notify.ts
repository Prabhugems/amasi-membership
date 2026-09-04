import { Resend } from "resend"
import { sendTemplate } from "@/lib/whatsapp"
import type { AcademicEventApplication } from "./types"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

const FROM = "AMASI <noreply@amasi.org>"

export async function sendApplicantConfirmation(application: AcademicEventApplication): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: "AMASI application received",
    html: `<p>Dear ${application.organizer_name},</p>
      <p>Your application (ID ${application.id}) has been received and is under review by the AMASI Hon. Secretary.
      You'll be notified by email once a decision is made.</p>`,
  })
}

export async function sendSecretaryApprovalRequest(
  application: AcademicEventApplication,
  typeLabel: string,
  secretaryEmail: string,
  magicLinkUrl: string
): Promise<void> {
  await getResend().emails.send({
    from: FROM,
    to: secretaryEmail,
    subject: `Application for review: ${typeLabel} — ${application.organizer_name}`,
    html: `<p>A new ${typeLabel} application from ${application.organizer_name} (${application.primary_institution})
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
  await getResend().emails.send({
    from: FROM,
    to: recipientEmail,
    subject: `FYI: ${typeLabel} application from ${application.organizer_name}`,
    html: `<p>A new ${typeLabel} application from ${application.organizer_name} has been submitted and is
      awaiting the Hon. Secretary's decision. This is for your information only — no action is needed from you.</p>
      <p><a href="${viewLinkUrl}">View application and leave a remark</a></p>`,
  })
}

export async function sendOutcomeEmail(
  application: AcademicEventApplication,
  typeLabel: string,
  outcome: "approved" | "rejected" | "changes_requested",
  mouPdfBuffer?: Buffer
): Promise<void> {
  const subjectByOutcome = {
    approved: `Your ${typeLabel} application has been approved`,
    rejected: `Your ${typeLabel} application was not approved`,
    changes_requested: `Changes requested on your ${typeLabel} application`,
  }
  const bodyByOutcome = {
    approved: `<p>Congratulations — your application has been approved. The signed MOU is attached.</p>`,
    rejected: `<p>Your application was not approved.${application.rejection_reason ? ` Reason: ${application.rejection_reason}` : ""}</p>`,
    changes_requested: `<p>The Hon. Secretary has requested changes.${application.rejection_reason ? ` Details: ${application.rejection_reason}` : ""}</p>`,
  }
  await getResend().emails.send({
    from: FROM,
    to: application.email,
    subject: subjectByOutcome[outcome],
    html: `<p>Dear ${application.organizer_name},</p>${bodyByOutcome[outcome]}`,
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
