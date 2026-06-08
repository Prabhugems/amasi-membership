import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { escapeHtml } from "@/lib/html-escape"
import { logMembershipAuditEvent } from "@/lib/audit-log"
import { isExcludedEmail } from "@/lib/email-exclusions"
import { Resend } from "resend"

// Iterates stuck drafts with per-draft Razorpay SDK calls.
export const maxDuration = 60

const STEP_LABELS: Record<number, string> = {
  1: "Select Membership Type",
  2: "Email Verification",
  3: "Document Upload",
  4: "Review Details",
  5: "Payment",
  6: "Submission",
}

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://membership.amasi.org"
}

function stepLabel(step: number): string {
  return STEP_LABELS[step] || `Step ${step}`
}

function emailWrapper(title: string, bodyHtml: string): string {
  return `
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:linear-gradient(135deg,#0d9488,#14b8a6);border-radius:12px 12px 0 0;padding:20px 24px;">
        <h2 style="color:#fff;margin:0;font-size:18px;">${title}</h2>
      </div>
      <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;padding:24px;">
        ${bodyHtml}
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:16px;">AMASI Membership Management</p>
      </div>
    </div>
  `
}

// Structural type for the draft_applications columns this route reads.
// Not a full row — only what the SELECTs in this file project.
interface DraftRow {
  id: string
  email: string
  current_step: number
  status: string
  updated_at: string
  payment_order_id: string | null
  payment_id: string | null
  has_verified_payment: boolean | null
  created_at?: string
}

// Razorpay SDK returns loosely-typed objects. We only read .status here.
interface RazorpayStatusOnly {
  status: string
}

// Narrow an unknown thrown value to a printable string for logging.
function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === "string") return e
  try { return JSON.stringify(e) } catch { return String(e) }
}

// ---------------------------------------------------------------------------
// GET /api/cron/cleanup-drafts[?dryRun=true]
//
// Hourly draft maintenance. Soft-delete model (sets deleted_at, keeps row);
// storage files retained for the 90-day audit window (separate hard-delete
// sweep, not in this route).
//
// dryRun=true: returns the planned actions per draft without sending any
// email, writing any state, or logging any audit/step events.
// ---------------------------------------------------------------------------

const CRON_PAUSED = false

export async function GET(request: Request) {
  if (CRON_PAUSED) {
    return Response.json(
      { paused: true, reason: "Coordinator hard-pause pending Issues 1–4 (see SESSION-2026-04-26.md)" },
      { status: 503 },
    )
  }

  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true"

  type Action = {
    id: string; email: string; current_step: number; step_label: string;
    hours_idle: number; status: string;
    payment: { has_verified: boolean; order_id: string | null; payment_id: string | null };
    would_do: string; reason?: string;
  }
  const summary = {
    dry_run: dryRun,
    marked_stale: 0,
    reminders_sent: 0,
    reminders_sent_5h: 0,
    expired: 0,
    payment_holds: 0,
    refunds_completed: 0,
    would_act_on: [] as Action[],
  }

  const hoursIdle = (updated_at: string) =>
    Math.round(((Date.now() - new Date(updated_at).getTime()) / 3600000) * 10) / 10

  const planAction = (draft: DraftRow, would_do: string, reason?: string) => {
    summary.would_act_on.push({
      id: draft.id,
      email: draft.email,
      current_step: draft.current_step,
      step_label: stepLabel(draft.current_step),
      hours_idle: hoursIdle(draft.updated_at),
      status: draft.status,
      payment: {
        has_verified: !!draft.has_verified_payment,
        order_id: draft.payment_order_id || null,
        payment_id: draft.payment_id || null,
      },
      would_do,
      reason,
    })
  }

  try {
    const supabase = createAdminClient()
    const resend = dryRun ? null : getResend()
    const baseUrl = getBaseUrl()
    const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"

    // -----------------------------------------------------------------------
    // Authoritative paid-but-no-application lookup.
    //
    // The draft's own payment columns (has_verified_payment / payment_order_id
    // / payment_id) are NOT reliably synced when /api/payments/verify succeeds:
    // the payment is recorded in `membership_payments` (status='paid') and in
    // step_data, but the draft row frequently stays has_verified_payment=false
    // / payment_order_id=null (the step-5 enqueueDraftSave gets clobbered by a
    // racing step-4 save — see apply/page.tsx). Any cron payment branch that
    // trusts those columns alone is blind to real payments. That blindness
    // caused two bugs:
    //   (a) Step 1 mislabeled paid drafts `applicant_idle_step_N` instead of
    //       `applicant_paid_no_submission` (looked like an abandoner who never
    //       paid, when AMASI actually holds ₹4230); and
    //   (b) Step 3 / Step 3a would soft-delete them as "unpaid expired" at 48h
    //       and email the applicant "payment not completed".
    //
    // We build the set of emails with a captured payment that produced NEITHER
    // an application NOR a member — i.e. genuinely-paid-but-nothing-created.
    // (Renewals/upgrades by existing members are excluded via the member
    // anti-join, so their lingering drafts aren't misclassified.)
    //
    // KNOWN RESIDUAL GAP: Step 4's own SELECT still keys on the unsynced draft
    // columns, so it does not route these to payment_on_hold + admin alert.
    // Closing that needs Step 4 to consult membership_payments too — tracked as
    // a follow-up. This change fixes the label and the wrongful-expiry risk.
    const paidNoAppEmails = new Set<string>()
    {
      const { data: paidRows } = await supabase
        .from("membership_payments")
        .select("member_email")
        .eq("status", "paid")
      const emails = Array.from(
        new Set((paidRows || []).map((r) => (r.member_email || "").toLowerCase()).filter(Boolean)),
      )
      if (emails.length > 0) {
        const [{ data: apps }, { data: mems }] = await Promise.all([
          supabase.from("membership_applications").select("email, status").in("email", emails),
          supabase.from("members").select("email").in("email", emails),
        ])
        // A `pending_payment` application is NOT a settled application — it's the
        // WS-C early skeleton, created before payment, whose finalizing submit
        // may never have run. Treat it like "no application" so a paid-but-
        // unfinalized applicant still gets flagged for recovery from their draft
        // rather than looking settled. (No-op while WS-C is off — no such rows.)
        const settled = new Set(
          [
            ...(apps || []).filter((a) => a.status !== "pending_payment").map((r) => (r.email || "").toLowerCase()),
            ...(mems || []).map((r) => (r.email || "").toLowerCase()),
          ].filter(Boolean),
        )
        for (const e of emails) if (!settled.has(e)) paidNoAppEmails.add(e)
      }
    }
    const isPaidNoApp = (email: string | null | undefined) =>
      paidNoAppEmails.has((email || "").toLowerCase())

    // -----------------------------------------------------------------------
    // Step 1 — Mark stale (in_progress + 2h idle → stuck)
    // Internal state only, does NOT bump updated_at (preserves user-activity
    // clock for the 18h reminder logic).
    // -----------------------------------------------------------------------
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString()
    const { data: staleDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment")
      .eq("status", "in_progress")
      .lt("updated_at", twoHoursAgo)
      .is("deleted_at", null)

    for (const draft of staleDrafts || []) {
      // Classify by authoritative payment state, NOT the draft's own columns.
      // A captured-but-unconverted payment is "paid, never submitted" — never
      // an "idle" abandoner.
      const paidNoApp = isPaidNoApp(draft.email)
      const failureReason = paidNoApp
        ? "applicant_paid_no_submission"
        : `applicant_idle_step_${draft.current_step}`
      if (dryRun) {
        planAction(draft, "mark_stale", paidNoApp ? "paid (membership_payments) but no application — paid_no_submission" : "in_progress >2h idle")
        continue
      }
      const { error } = await supabase
        .from("draft_applications")
        .update({
          status: "stuck",
          stale_since: new Date().toISOString(),
          failure_reason: failureReason,
        })
        .eq("id", draft.id)
      if (!error) {
        summary.marked_stale++
        await logMembershipAuditEvent({
          action: "draft_marked_stale",
          entityType: "draft_application",
          entityId: draft.id,
          newData: { step: draft.current_step, reason: "Inactive for 2+ hours" },
          performedBy: "system",
        }, supabase)
      } else console.error(`[cleanup-drafts] mark stale ${draft.id}:`, error.message)
    }

    // -----------------------------------------------------------------------
    // Step 1b — 5h-from-updated_at reminder (early-stall, all incomplete drafts)
    //   2026-05-26: complement to the 18h reminder (Step 2). Targets drafts
    //   idle 5h+ that haven't been reminded yet. Unlike Step 2 it does NOT
    //   require step_data.formData — deliberately includes OTP-only drafts
    //   (verified email, never selected type / filled form). Per design
    //   reversal of the prior "no cold-call spam" policy.
    // -----------------------------------------------------------------------
    const fiveHoursAgo = new Date(Date.now() - 5 * 3600000).toISOString()
    const { data: earlyReminderDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", fiveHoursAgo)
      .is("reminder_sent_at", null)
      .is("deleted_at", null)

    for (const draft of earlyReminderDrafts || []) {
      if (dryRun) {
        const why = isExcludedEmail(draft.email)
          ? `excluded address; would mark reminder_sent_at without emailing`
          : `${hoursIdle(draft.updated_at)}h idle, no prior reminder (5h branch)`
        planAction(draft, "send_reminder_5h", why)
        continue
      }
      if (isExcludedEmail(draft.email)) {
        await supabase
          .from("draft_applications")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", draft.id)
        await logMembershipAuditEvent({
          action: "draft_reminder_skipped_excluded",
          entityType: "draft_application",
          entityId: draft.id,
          newData: { email: draft.email, step: draft.current_step, branch: "5h", reason: "excluded test/internal address" },
          performedBy: "system",
        }, supabase)
        continue
      }
      const html = emailWrapper(
        "Complete Your Application",
        `
        <p style="font-size:14px;color:#374151;margin:0 0 12px;">
          Your AMASI membership application is incomplete — it's paused at <strong>${escapeHtml(stepLabel(draft.current_step))}</strong>.
        </p>
        <p style="font-size:14px;color:#374151;margin:0 0 12px;">
          Pick up where you left off using the link below. If you've already verified your email, you'll be taken straight to the next step.
        </p>
        <div style="margin:20px 0;text-align:center;">
          <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Resume Application</a>
        </div>
        <p style="font-size:12px;color:#6b7280;margin:12px 0 0;">
          If you no longer wish to apply, your application will be removed after further inactivity.
        </p>
        `,
      )
      try {
        await resend!.emails.send({
          from: fromEmail,
          to: draft.email,
          subject: "Complete your AMASI membership application",
          html,
        })
        await supabase
          .from("draft_applications")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", draft.id)
        summary.reminders_sent_5h++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] reminder-5h email ${draft.email}:`, errMessage(err))
        Sentry.captureException(err, {
          tags: { component: "cron", cron: "cleanup-drafts", op: "reminder-email-5h" },
          extra: { draft_id: draft.id, email: draft.email, step: draft.current_step },
        })
      }
    }

    // -----------------------------------------------------------------------
    // Step 2 — Second reminder at 18h-from-updated_at
    //   Phase 2 (2026-05-26): repositioned as a SECOND nudge. Fires for
    //   18h-idle engaged drafts (formData present) whose 5h reminder is now
    //   ≥13h old, OR which escaped the 5h branch entirely (excluded-email
    //   bypass, pre-Phase-1 backlog). Cohort restriction stays — OTP-only
    //   drafts get exactly one nudge at 5h, then silent cleanup in Step 3a.
    // -----------------------------------------------------------------------
    const eighteenHoursAgo = new Date(Date.now() - 18 * 3600000).toISOString()
    const thirteenHoursAgo = new Date(Date.now() - 13 * 3600000).toISOString()
    const { data: reminderDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", eighteenHoursAgo)
      .or(`reminder_sent_at.is.null,reminder_sent_at.lt.${thirteenHoursAgo}`)
      .is("deleted_at", null)
      .not("step_data->formData", "is", null)

    for (const draft of reminderDrafts || []) {
      if (dryRun) {
        const why = isExcludedEmail(draft.email)
          ? `excluded address; would mark reminder_sent_at without emailing`
          : `${hoursIdle(draft.updated_at)}h idle, 18h second-nudge branch`
        planAction(draft, "send_reminder_18h", why)
        continue
      }
      // Skip the email send for excluded addresses (test/internal). Mark
      // reminder_sent_at so the row drops out of future picks; no send needed.
      if (isExcludedEmail(draft.email)) {
        await supabase
          .from("draft_applications")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", draft.id)
        await logMembershipAuditEvent({
          action: "draft_reminder_skipped_excluded",
          entityType: "draft_application",
          entityId: draft.id,
          newData: { email: draft.email, step: draft.current_step, reason: "excluded test/internal address" },
          performedBy: "system",
        }, supabase)
        continue
      }
      const html = emailWrapper(
        "Complete Your Application",
        `
        <p style="font-size:14px;color:#374151;margin:0 0 12px;">
          Your AMASI membership application is incomplete — it's paused at <strong>${escapeHtml(stepLabel(draft.current_step))}</strong>.
        </p>
        <p style="font-size:14px;color:#374151;margin:0 0 12px;">
          Pick up where you left off using the link below. If you've already verified your email, you'll be taken straight to the next step.
        </p>
        <div style="margin:20px 0;text-align:center;">
          <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Resume Application</a>
        </div>
        <p style="font-size:12px;color:#6b7280;margin:12px 0 0;">
          If you no longer wish to apply, your application will be removed soon.
        </p>
        `,
      )
      // Send-then-update. Setting reminder_sent_at only after a successful
      // send means transient Resend failures get re-picked next run (still
      // capped by the broader retry budget upstream). The Sentry capture
      // gives loud visibility for what used to be silent loss.
      try {
        await resend!.emails.send({
          from: fromEmail,
          to: draft.email,
          subject: "Complete your AMASI membership application",
          html,
        })
        await supabase
          .from("draft_applications")
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq("id", draft.id)
        summary.reminders_sent++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] reminder email ${draft.email}:`, errMessage(err))
        Sentry.captureException(err, {
          tags: { component: "cron", cron: "cleanup-drafts", op: "reminder-email" },
          extra: { draft_id: draft.id, email: draft.email, step: draft.current_step },
        })
      }
    }

    // -----------------------------------------------------------------------
    // Cutoffs used by Step 3a, Step 3, Step 4 below.
    // -----------------------------------------------------------------------
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 3600000).toISOString()
    const sixHoursAgo = new Date(Date.now() - 6 * 3600000).toISOString()

    // -----------------------------------------------------------------------
    // Step 3a — Silent soft-delete for OTP-only drafts (no formData)
    //   These applicants verified an email but never selected a membership
    //   type or filled any form field. Sending them a "complete your
    //   application" email reads as cold-call spam. Cleanup happens silently
    //   with full audit-log capture (step_data snapshot retained).
    //
    //   PAYMENT GUARD: must be unpaid AND no payment order. A paid draft
    //   without formData (rare edge case) is NEVER silently deleted — it
    //   stays in stuck for admin review.
    // -----------------------------------------------------------------------
    const { data: otpOnlyDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, phone, current_step, status, updated_at, created_at, step_data, payment_order_id, payment_id, has_verified_payment")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", fortyEightHoursAgo)
      .eq("has_verified_payment", false)
      .is("payment_order_id", null)
      .is("deleted_at", null)
      .is("step_data->formData", null)

    for (const draft of otpOnlyDrafts || []) {
      // Safety: never silent-delete a draft that actually paid. The query's
      // has_verified_payment=false / payment_order_id=null filters can't see
      // payments recorded only in membership_payments (unsynced draft columns).
      if (isPaidNoApp(draft.email)) {
        if (dryRun) planAction(draft, "skip_paid_no_submission", "captured payment in membership_payments — not an unpaid OTP-only draft")
        continue
      }
      if (dryRun) {
        planAction(draft, "silent_soft_delete_no_formdata", `OTP-only abandoned, ${hoursIdle(draft.updated_at)}h idle, no formData persisted`)
        continue
      }
      try {
        const { data: marked } = await supabase
          .from("draft_applications")
          .update({ status: "expired", deleted_at: new Date().toISOString(), failure_reason: "applicant_otp_only_no_formdata" })
          .eq("id", draft.id)
          .is("payment_order_id", null)
          .eq("has_verified_payment", false)
          .is("step_data->formData", null)
          .select("id")
          .maybeSingle()
        if (!marked) { console.log(`[cleanup-drafts] skipped silent ${draft.id}: state changed during cleanup`); continue }
        await logMembershipAuditEvent({
          action: "draft_silent_expired_no_formdata",
          entityType: "draft_application",
          entityId: draft.id,
          newData: {
            email: draft.email,
            phone: (draft as { phone?: string | null }).phone ?? null,
            step: draft.current_step,
            created_at: draft.created_at,
            reason: "Soft-deleted silently — applicant verified email but never selected a membership type or filled the form (no step_data.formData)",
            step_data_snapshot: (draft as { step_data?: unknown }).step_data ?? null,
          },
          performedBy: "system",
        }, supabase)
        summary.expired++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] silent expire ${draft.id}:`, errMessage(err))
      }
    }

    // -----------------------------------------------------------------------
    // Step 3 — Soft-delete unpaid drafts (48h idle, no payment)
    // Issue 2 guarantee: only expire drafts that have already been reminded
    // and given a 6h grace window. This prevents reminder + expiry firing in
    // the same cron invocation for backlog drafts that are >48h on first
    // sight. They get the reminder this run; expire on the next-day's run.
    // Files in storage are KEPT for the 90-day audit window.
    // -----------------------------------------------------------------------
    const { data: expiredDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment, created_at")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", fortyEightHoursAgo)
      .eq("has_verified_payment", false)
      .is("payment_order_id", null)
      .is("deleted_at", null)
      .not("reminder_sent_at", "is", null)
      .lt("reminder_sent_at", sixHoursAgo)

    for (const draft of expiredDrafts || []) {
      // Safety: never expire-as-unpaid a draft that actually paid. The query
      // filters on the draft's own (unsynced) payment columns and would
      // otherwise delete a paid applicant and email them "payment not
      // completed". membership_payments is the source of truth.
      if (isPaidNoApp(draft.email)) {
        if (dryRun) planAction(draft, "skip_paid_no_submission", "captured payment in membership_payments — not unpaid; left as stuck/paid_no_submission for admin")
        continue
      }
      if (dryRun) {
        const why = isExcludedEmail(draft.email)
          ? `unpaid, ${hoursIdle(draft.updated_at)}h idle, excluded address (would soft-delete without emailing)`
          : `unpaid, ${hoursIdle(draft.updated_at)}h idle, reminder sent ≥6h ago`
        planAction(draft, "soft_delete_unpaid", why)
        continue
      }
      try {
        const { data: marked } = await supabase
          .from("draft_applications")
          .update({ status: "expired", deleted_at: new Date().toISOString(), failure_reason: "applicant_unpaid_expired" })
          .eq("id", draft.id)
          .is("payment_order_id", null)
          .eq("has_verified_payment", false)
          .select("id")
          .maybeSingle()
        if (!marked) { console.log(`[cleanup-drafts] skipped ${draft.id}: payment arrived during expiry`); continue }
        if (!isExcludedEmail(draft.email)) {
          const html = emailWrapper(
            "Application Expired",
            `
            <p style="font-size:14px;color:#374151;margin:0 0 12px;">
              Your AMASI membership application has been removed due to inactivity.
              You were on: <strong>${escapeHtml(stepLabel(draft.current_step))}</strong>.
            </p>
            <p style="font-size:14px;color:#374151;margin:0 0 12px;">
              If you still wish to join, you can start a new application at any time.
            </p>
            <div style="margin:20px 0;text-align:center;">
              <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Start New Application</a>
            </div>
            `,
          )
          await resend!.emails.send({
            from: fromEmail,
            to: draft.email,
            subject: "Your AMASI membership application has expired",
            html,
          })
        }
        await logMembershipAuditEvent({
          action: "draft_expired",
          entityType: "draft_application",
          entityId: draft.id,
          newData: {
            email: draft.email,
            step: draft.current_step,
            reason: "Soft-deleted after 48h inactivity (files retained)",
            email_skipped: isExcludedEmail(draft.email) ? "excluded address" : null,
          },
          performedBy: "system",
        }, supabase)
        summary.expired++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] expire ${draft.id}:`, errMessage(err))
      }
    }

    // -----------------------------------------------------------------------
    // Step 4 — Paid-but-stuck drafts (48h idle, payment present)
    //   - Razorpay paid/captured → status=payment_on_hold + admin alert (manual refund)
    //   - Razorpay attempted → skip (may complete)
    //   - Else → soft-delete (treat as unpaid)
    // -----------------------------------------------------------------------
    const { data: paidStuckDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment, created_at, reminder_sent_at")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", fortyEightHoursAgo)
      .or("payment_order_id.not.is.null,has_verified_payment.eq.true")
      .is("deleted_at", null)

    if (paidStuckDrafts && paidStuckDrafts.length > 0) {
      const Razorpay = (await import("razorpay")).default
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
      })

      for (const draft of paidStuckDrafts) {
        try {
          if (draft.payment_order_id) {
            const order = await razorpay.orders.fetch(draft.payment_order_id)
            const status = (order as RazorpayStatusOnly).status

            if (status === "paid" || status === "captured") {
              if (dryRun) { planAction(draft, "flag_payment_on_hold", `Razorpay order ${status} (admin manual refund)`); continue }
              await supabase
                .from("draft_applications")
                .update({ status: "payment_on_hold", has_verified_payment: true, updated_at: new Date().toISOString(), failure_reason: "applicant_paid_no_submission" })
                .eq("id", draft.id)
              const { data: admins } = await supabase
                .from("admin_users")
                .select("email")
                .eq("is_active", true)
              if (admins && admins.length > 0) {
                const alertHtml = emailWrapper(
                  "Payment On Hold — Action Required",
                  `
                  <p style="font-size:14px;color:#374151;margin:0 0 12px;">A paid draft application is stuck and requires manual review.</p>
                  <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
                    <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Email</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(draft.email)}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;">Step</td><td style="padding:8px 0;">${escapeHtml(stepLabel(draft.current_step))}</td></tr>
                    <tr><td style="padding:8px 0;color:#6b7280;">Order ID</td><td style="padding:8px 0;font-family:monospace;">${escapeHtml(draft.payment_order_id || "N/A")}</td></tr>
                  </table>
                  <div style="margin:20px 0;text-align:center;">
                    <a href="${escapeHtml(baseUrl)}/pending" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review in Admin Panel</a>
                  </div>
                  `,
                )
                await Promise.allSettled(
                  admins.map((admin) => resend!.emails.send({ from: fromEmail, to: admin.email, subject: `Payment On Hold: ${draft.email}`, html: alertHtml })),
                )
              }
              await logMembershipAuditEvent({
                action: "draft_payment_on_hold",
                entityType: "draft_application",
                entityId: draft.id,
                newData: { email: draft.email, payment_order_id: draft.payment_order_id },
                performedBy: "system",
              }, supabase)
              summary.payment_holds++
            } else if (status === "attempted") {
              if (dryRun) planAction(draft, "skip_payment_attempted", "Razorpay order in attempted state, may complete")
              continue
            } else {
              // Same Issue-2 guard as Step 3: only expire if reminder was sent ≥6h ago
              const r = (draft as { reminder_sent_at?: string | null }).reminder_sent_at
              const remindedLongEnough = r && new Date(r).getTime() < Date.now() - 6 * 3600000
              if (!remindedLongEnough) {
                if (dryRun) planAction(draft, "skip_no_reminder_grace", `Razorpay status=${status} but no reminder ≥6h ago`)
                continue
              }
              if (dryRun) {
                const why = isExcludedEmail(draft.email)
                  ? `Razorpay status=${status}, excluded address (would soft-delete without emailing)`
                  : `Razorpay status=${status}, treating as unpaid, reminder sent ≥6h ago`
                planAction(draft, "soft_delete_payment_failed", why)
                continue
              }
              if (!isExcludedEmail(draft.email)) {
                try {
                  await resend!.emails.send({
                    from: fromEmail,
                    to: draft.email,
                    subject: "Your AMASI membership application has expired",
                    html: emailWrapper(
                      "Application Expired",
                      `
                      <p style="font-size:14px;color:#374151;">Dear Applicant,</p>
                      <p style="font-size:14px;color:#555;line-height:1.6;">
                        Your AMASI membership application started on ${draft.created_at ? new Date(draft.created_at).toLocaleDateString("en-IN") : "recently"}
                        has expired due to inactivity. The payment was not completed.
                      </p>
                      <p style="font-size:14px;color:#555;line-height:1.6;">You are welcome to apply again at any time.</p>
                      <div style="text-align:center;margin:24px 0;">
                        <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Apply Again</a>
                      </div>
                      `,
                    ),
                  })
                } catch (emailErr) {
                  console.error(`[cleanup-drafts] expiry email (paid-uncaptured) ${draft.email}:`, emailErr)
                }
              }
              const { data: marked } = await supabase
                .from("draft_applications")
                .update({ status: "expired", deleted_at: new Date().toISOString(), failure_reason: "applicant_unpaid_expired" })
                .eq("id", draft.id)
                .eq("has_verified_payment", false)
                .select("id")
                .maybeSingle()
              if (!marked) { console.log(`[cleanup-drafts] skipped ${draft.id}: payment verified during expiry`); continue }
              await logMembershipAuditEvent({
                action: "draft_expired",
                entityType: "draft_application",
                entityId: draft.id,
                newData: {
                  email: draft.email,
                  step: draft.current_step,
                  reason: "Soft-deleted after 48h inactivity — payment not captured (files retained)",
                  email_skipped: isExcludedEmail(draft.email) ? "excluded address" : null,
                },
                performedBy: "system",
              }, supabase)
              summary.expired++
            }
          } else {
            // has_verified_payment but no order_id → mark on hold
            if (dryRun) { planAction(draft, "flag_payment_on_hold", "has_verified_payment=true but no order_id"); continue }
            await supabase
              .from("draft_applications")
              .update({ status: "payment_on_hold", updated_at: new Date().toISOString(), failure_reason: "applicant_paid_no_submission" })
              .eq("id", draft.id)
            await logMembershipAuditEvent({
              action: "draft_payment_on_hold",
              entityType: "draft_application",
              entityId: draft.id,
              newData: { email: draft.email, payment_order_id: draft.payment_order_id },
              performedBy: "system",
            }, supabase)
            summary.payment_holds++
          }
        } catch (err: unknown) {
          console.error(`[cleanup-drafts] paid-stuck check ${draft.id}:`, errMessage(err))
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4b — Paid-but-no-application drafts (authoritative).
    //   Closes the gap Step 4's column-based SELECT leaves open: the payment is
    //   recorded in membership_payments (status='paid') but the draft's own
    //   payment columns never synced, so Step 4 never sees it. We use the
    //   authoritative paidNoAppEmails set instead. Targets only already-`stuck`
    //   drafts (past the 2h grace) so a freshly-paid draft whose client-side
    //   submit retries are still in flight isn't flagged prematurely. Routes to
    //   payment_on_hold + one admin alert (status change drops the row out of
    //   the in_progress/stuck selection next run, so no repeat alerts). A human
    //   then recovers it (promote to application) or refunds.
    // -----------------------------------------------------------------------
    if (paidNoAppEmails.size > 0) {
      const { data: candidatePaidDrafts } = await supabase
        .from("draft_applications")
        .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment")
        .eq("status", "stuck")
        .is("deleted_at", null)

      const paidNoAppDrafts = (candidatePaidDrafts || []).filter((d) => isPaidNoApp(d.email))

      if (paidNoAppDrafts.length > 0) {
        const { data: holdAdmins } = dryRun
          ? { data: null }
          : await supabase.from("admin_users").select("email").eq("is_active", true)

        for (const draft of paidNoAppDrafts) {
          if (dryRun) {
            planAction(draft, "flag_payment_on_hold_paid_no_app", "captured payment in membership_payments, no application — route to payment_on_hold + admin alert")
            continue
          }
          const { data: marked } = await supabase
            .from("draft_applications")
            .update({
              status: "payment_on_hold",
              has_verified_payment: true,
              failure_reason: "applicant_paid_no_submission",
              updated_at: new Date().toISOString(),
            })
            .eq("id", draft.id)
            .eq("status", "stuck")
            .select("id")
            .maybeSingle()
          if (!marked) { console.log(`[cleanup-drafts] skipped paid-no-app ${draft.id}: state changed during update`); continue }

          if (holdAdmins && holdAdmins.length > 0) {
            const alertHtml = emailWrapper(
              "Paid — No Application Created (Action Required)",
              `
              <p style="font-size:14px;color:#374151;margin:0 0 12px;">An applicant paid but no membership application was ever created. Their payment is captured in Razorpay; the draft is stuck. Recover it (promote to an application) or refund.</p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;color:#374151;">
                <tr><td style="padding:8px 0;color:#6b7280;width:140px;">Email</td><td style="padding:8px 0;font-weight:600;">${escapeHtml(draft.email)}</td></tr>
                <tr><td style="padding:8px 0;color:#6b7280;">Step</td><td style="padding:8px 0;">${escapeHtml(stepLabel(draft.current_step))}</td></tr>
              </table>
              <div style="margin:20px 0;text-align:center;">
                <a href="${escapeHtml(baseUrl)}/incomplete" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Review in Admin Panel</a>
              </div>
              `,
            )
            await Promise.allSettled(
              holdAdmins.map((admin) => resend!.emails.send({ from: fromEmail, to: admin.email, subject: `Paid, no application: ${draft.email}`, html: alertHtml })),
            )
          }
          await logMembershipAuditEvent({
            action: "draft_payment_on_hold",
            entityType: "draft_application",
            entityId: draft.id,
            newData: { email: draft.email, reason: "paid_no_submission (authoritative: membership_payments paid, no application/member)" },
            performedBy: "system",
          }, supabase)
          summary.payment_holds++
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 5 — Refund completion check (status='refund_initiated')
    // On Razorpay-confirmed refund → soft-delete (storage files retained).
    // -----------------------------------------------------------------------
    const { data: refundDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment")
      .eq("status", "refund_initiated")
      .is("deleted_at", null)

    if (refundDrafts && refundDrafts.length > 0) {
      const Razorpay = (await import("razorpay")).default
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
      })

      for (const draft of refundDrafts) {
        try {
          if (!draft.payment_order_id && !draft.payment_id) continue
          let refunded = false
          if (draft.payment_order_id) {
            const order = await razorpay.orders.fetch(draft.payment_order_id)
            if ((order as RazorpayStatusOnly).status === "refunded") refunded = true
          }
          if (!refunded && draft.payment_id) {
            try {
              const paymentDetail = await razorpay.payments.fetch(draft.payment_id)
              if ((paymentDetail as RazorpayStatusOnly).status === "refunded") refunded = true
            } catch { /* skip this round */ }
          }

          if (refunded) {
            if (dryRun) {
              const why = isExcludedEmail(draft.email)
                ? "Razorpay confirms refund completed; excluded address (would soft-delete without emailing)"
                : "Razorpay confirms refund completed"
              planAction(draft, "soft_delete_refund_completed", why)
              continue
            }
            if (!isExcludedEmail(draft.email)) {
              await resend!.emails.send({
                from: fromEmail,
                to: draft.email,
                subject: "AMASI membership application — refund processed",
                html: emailWrapper(
                  "Refund Processed",
                  `
                  <p style="font-size:14px;color:#374151;margin:0 0 12px;">Your payment for the AMASI membership application has been refunded successfully.</p>
                  <p style="font-size:14px;color:#374151;margin:0 0 12px;">If you wish to apply again in the future, you are welcome to start a new application.</p>
                  <div style="margin:20px 0;text-align:center;">
                    <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Start New Application</a>
                  </div>
                  `,
                ),
              })
            }
            await supabase
              .from("draft_applications")
              .update({ status: "expired", deleted_at: new Date().toISOString() })
              .eq("id", draft.id)
            await logMembershipAuditEvent({
              action: "draft_refunded",
              entityType: "draft_application",
              entityId: draft.id,
              newData: {
                email: draft.email,
                step: draft.current_step,
                reason: "Refund completed — soft-deleted (files retained)",
                email_skipped: isExcludedEmail(draft.email) ? "excluded address" : null,
              },
              performedBy: "system",
            }, supabase)
            summary.refunds_completed++
          }
        } catch (err: unknown) {
          console.error(`[cleanup-drafts] refund check ${draft.id}:`, errMessage(err))
        }
      }
    }

    console.log("[cleanup-drafts] completed:", summary)
    return Response.json(summary)
  } catch (error: unknown) {
    console.error("[cleanup-drafts] fatal error:", errMessage(error))
    return Response.json({ error: "Cleanup failed" }, { status: 500 })
  }
}
