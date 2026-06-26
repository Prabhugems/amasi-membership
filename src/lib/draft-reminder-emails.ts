import { escapeHtml } from "@/lib/html-escape"

export const INCOMPLETE_REMINDER_SUBJECT =
  "Complete your AMASI membership application"

export const PAID_PENDING_REMINDER_SUBJECT =
  "Action needed: payment received, submission incomplete"

export const INCOMPLETE_REMINDER_TITLE = "Complete Your Application"

export const PAID_PENDING_REMINDER_TITLE = "Submit Your Application"

interface IncompleteBodyOptions {
  stepLabel: string
  resumeUrl: string
  removalHint?: string
}

interface PaidPendingBodyOptions {
  resumeUrl: string
}

export function buildIncompleteReminderBody({
  stepLabel,
  resumeUrl,
  removalHint,
}: IncompleteBodyOptions): string {
  return `
    <p style="font-size:14px;color:#374151;margin:0 0 12px;">
      Your AMASI membership application is incomplete — it's paused at <strong>${escapeHtml(stepLabel)}</strong>.
    </p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px;">
      Pick up where you left off using the link below. If you've already verified your email, you'll be taken straight to the next step.
    </p>
    <div style="margin:20px 0;text-align:center;">
      <a href="${escapeHtml(resumeUrl)}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Resume Application</a>
    </div>
    ${removalHint ? `<p style="font-size:12px;color:#6b7280;margin:12px 0 0;">${escapeHtml(removalHint)}</p>` : ""}
  `
}

export function buildPaidPendingReminderBody({
  resumeUrl,
}: PaidPendingBodyOptions): string {
  return `
    <p style="font-size:14px;color:#374151;margin:0 0 12px;">
      We received your AMASI membership payment, but the application itself didn't finish submitting.
    </p>
    <p style="font-size:14px;color:#374151;margin:0 0 12px;">
      Your details and uploaded documents are saved. Open the link below to finish the final submission step — <strong>you will not be charged again</strong>.
    </p>
    <div style="margin:20px 0;text-align:center;">
      <a href="${escapeHtml(resumeUrl)}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Complete Submission</a>
    </div>
    <p style="font-size:12px;color:#6b7280;margin:12px 0 0;">
      Trouble opening the link? Reply to this email or write to <a href="mailto:support@amasi.org" style="color:#0d9488;">support@amasi.org</a>. Please do not start a new application — it will not be linked to your existing payment.
    </p>
  `
}
