import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

const baseUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "https://amasi-membership.vercel.app")

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

const DEFAULT_MIN_HOURS_IDLE = 24
const MIN_HOURS_SINCE_LAST_REMINDER = 48

interface SkipReason {
  email: string
  reason: string
}

export async function GET() {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const minHours = DEFAULT_MIN_HOURS_IDLE
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
    console.error("Preview bulk reminders error:", error)
    return Response.json({ status: false, message: "Failed to load preview" }, { status: 500 })
  }

  return Response.json({
    status: true,
    eligible_count: (drafts || []).length,
    min_hours_idle: minHours,
  })
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const minHours = typeof body.minHoursIdle === "number" && body.minHoursIdle > 0
    ? body.minHoursIdle
    : DEFAULT_MIN_HOURS_IDLE

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
    console.error("Fetch bulk reminder drafts error:", error)
    return Response.json({ status: false, message: "Failed to fetch drafts" }, { status: 500 })
  }

  const candidates = drafts || []
  if (candidates.length === 0) {
    return Response.json({ status: true, sent: 0, skipped: 0, skippedDetails: [], message: "No eligible drafts" })
  }

  // Load every email that already has a submitted membership_applications row.
  // Reminding those users about their draft would be confusing.
  const emails = Array.from(new Set(candidates.map(d => d.email?.toLowerCase()).filter(Boolean) as string[]))
  const { data: existingApps } = await supabase
    .from("membership_applications")
    .select("email")
    .in("email", emails)

  const alreadySubmitted = new Set((existingApps || []).map(a => a.email?.toLowerCase()))

  const resend = getResend()
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"

  let sent = 0
  const skipped: SkipReason[] = []

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
                Your progress has been saved. Click below to sign back in with your email OTP and pick up where you left off.
              </p>
              <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${escapeHtml(baseUrl)}/apply"
                   style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                  Resume Application
                </a>
              </div>
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
      console.error(`Bulk reminder send to ${email}:`, err)
      skipped.push({ email, reason: "email send failed" })
    }
  }

  await supabase.from("membership_audit_log").insert({
    action: "bulk_draft_reminders_sent",
    target_type: "draft_application",
    target_id: null,
    performed_by: typeof session.email === "string" ? session.email : "admin",
    details: { sent, skipped_count: skipped.length, min_hours_idle: minHours } as unknown as Record<string, unknown>,
  }).then(({ error }) => {
    if (error) console.error("Audit log error:", error)
  })

  return Response.json({
    status: true,
    sent,
    skipped: skipped.length,
    skippedDetails: skipped,
  })
}
