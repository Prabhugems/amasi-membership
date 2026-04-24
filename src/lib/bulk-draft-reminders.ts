import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase"
import { escapeHtml } from "@/lib/html-escape"
import { signResumeToken } from "@/lib/draft-resume"
import { logMembershipAuditEvent } from "@/lib/audit-log"

const STEP_LABELS: Record<number, string> = {
  1: "Select Membership Type",
  2: "Email Verification",
  3: "Document Upload",
  4: "Review Details",
  5: "Payment",
  6: "Submission",
}

// Emails that should never receive a marketing-style reminder
const EMAIL_EXCLUDE_PATTERNS = [
  /@test\./i,
  /^test@/i,
  /^collegeofamasi@/i,
  /^admin@/i,
  /^noreply@/i,
]

export const DEFAULT_MIN_HOURS_IDLE = 24
export const MIN_HOURS_SINCE_LAST_REMINDER = 48

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://amasi-membership.vercel.app")

export interface BulkReminderResult {
  sent: number
  skipped: number
  skippedDetails: { email: string; reason: string }[]
  eligibleCount: number
}

export async function countEligibleDrafts(minHoursIdle = DEFAULT_MIN_HOURS_IDLE): Promise<number> {
  const supabase = createAdminClient()
  const cutoff = new Date(Date.now() - minHoursIdle * 60 * 60 * 1000).toISOString()
  const reminderCutoff = new Date(Date.now() - MIN_HOURS_SINCE_LAST_REMINDER * 60 * 60 * 1000).toISOString()

  const { count } = await supabase
    .from("draft_applications")
    .select("*", { count: "exact", head: true })
    .in("status", ["in_progress", "stuck"])
    .lte("updated_at", cutoff)
    .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${reminderCutoff}`)

  return count ?? 0
}

/**
 * Run the bulk draft reminder job.
 *
 * @param actor   Who initiated: "admin:<email>" or "system:cron-bulk-reminder"
 * @param options.minHoursIdle  Override default 24h idle threshold
 */
export async function runBulkDraftReminders(
  actor: string,
  options: { minHoursIdle?: number } = {}
): Promise<BulkReminderResult> {
  const minHours = options.minHoursIdle && options.minHoursIdle > 0 ? options.minHoursIdle : DEFAULT_MIN_HOURS_IDLE
  const supabase = createAdminClient()

  const cutoff = new Date(Date.now() - minHours * 60 * 60 * 1000).toISOString()
  const reminderCutoff = new Date(Date.now() - MIN_HOURS_SINCE_LAST_REMINDER * 60 * 60 * 1000).toISOString()

  const { data: drafts, error } = await supabase
    .from("draft_applications")
    .select("id, email, current_step, updated_at, reminder_sent_at, status")
    .in("status", ["in_progress", "stuck"])
    .lte("updated_at", cutoff)
    .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${reminderCutoff}`)

  if (error) {
    throw new Error(`Fetch candidate drafts failed: ${error.message}`)
  }

  const candidates = drafts || []
  if (candidates.length === 0) {
    return { sent: 0, skipped: 0, skippedDetails: [], eligibleCount: 0 }
  }

  const emails = Array.from(new Set(candidates.map(d => d.email?.toLowerCase()).filter(Boolean) as string[]))
  const { data: existingApps } = await supabase
    .from("membership_applications")
    .select("email")
    .in("email", emails)

  const alreadySubmitted = new Set((existingApps || []).map(a => a.email?.toLowerCase()))

  const resendKey = process.env.RESEND_API_KEY?.trim()
  if (!resendKey) {
    throw new Error("RESEND_API_KEY not configured")
  }
  const resend = new Resend(resendKey)
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"

  let sent = 0
  const skipped: { email: string; reason: string }[] = []

  for (const draft of candidates) {
    const email = draft.email?.trim()
    if (!email) { skipped.push({ email: "(blank)", reason: "no email" }); continue }

    if (EMAIL_EXCLUDE_PATTERNS.some(p => p.test(email))) {
      skipped.push({ email, reason: "excluded (test/internal)" })
      continue
    }

    if (alreadySubmitted.has(email.toLowerCase())) {
      skipped.push({ email, reason: "already has submitted application" })
      continue
    }

    const currentStep = draft.current_step || 1
    const stepLabel = escapeHtml(STEP_LABELS[currentStep] || `Step ${currentStep}`)
    const resumeToken = await signResumeToken(draft.id, email)
    const resumeUrl = `${baseUrl}/apply?resume=${encodeURIComponent(resumeToken)}`

    try {
      await resend.emails.send({
        from,
        to: email,
        subject: "Complete your AMASI membership application",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
              <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
            </div>
            <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
              <p style="color: #374151; font-size: 15px;">Dear Applicant,</p>
              <p style="color: #555; font-size: 14px; line-height: 1.6;">
                We noticed your AMASI membership application is still incomplete. You stopped at
                <strong>${stepLabel}</strong>.
              </p>
              <p style="color: #555; font-size: 14px; line-height: 1.6;">
                Click below to pick up exactly where you left off — no need to re-enter your details.
              </p>
              <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${escapeHtml(resumeUrl)}"
                   style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                  Resume Application
                </a>
              </div>
              <p style="color: #999; font-size: 12px; text-align: center;">This link works for 14 days and only for this email address.</p>
              <p style="color: #555; font-size: 13px;">Questions? Contact <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          </div>
        `,
      })

      await supabase
        .from("draft_applications")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", draft.id)

      sent++
    } catch (err) {
      console.error(`[bulk-reminder] send to ${email}:`, err)
      skipped.push({ email, reason: "email send failed" })
    }
  }

  // entity_id is NOT NULL in the DB — use a per-batch synthetic id
  await logMembershipAuditEvent({
    action: "bulk_draft_reminders_sent",
    entityType: "draft_application",
    entityId: `bulk_${Date.now()}`,
    performedBy: actor,
    newData: { sent, skipped_count: skipped.length, min_hours_idle: minHours },
  }, supabase)

  return { sent, skipped: skipped.length, skippedDetails: skipped, eligibleCount: candidates.length }
}
