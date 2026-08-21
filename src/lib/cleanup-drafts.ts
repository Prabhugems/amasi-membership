import { createAdminClient } from "@/lib/supabase"
import { escapeHtml } from "@/lib/html-escape"
import { logMembershipAuditEvent } from "@/lib/audit-log"
import { isExcludedEmail } from "@/lib/email-exclusions"
import { extractStoragePaths } from "@/lib/draft-utils"
import { Resend } from "resend"

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

// Structural type for the draft_applications columns this job reads.
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

export type CleanupDraftsAction = {
  id: string; email: string; current_step: number; step_label: string;
  hours_idle: number; status: string;
  payment: { has_verified: boolean; order_id: string | null; payment_id: string | null };
  would_do: string; reason?: string;
}

export interface CleanupDraftsSummary {
  dry_run: boolean
  marked_stale: number
  expired: number
  hard_deleted: number
  payment_holds: number
  refunds_completed: number
  would_act_on: CleanupDraftsAction[]
}

// ---------------------------------------------------------------------------
// runCleanupDrafts — hourly draft maintenance, extracted from
// src/app/api/cron/cleanup-drafts/route.ts (2026-08-20) so it's testable in
// isolation, matching the pattern already used by src/lib/bulk-draft-reminders.ts.
// The route stays a thin wrapper: auth + dryRun query-param parsing + this call.
//
// Policy (2026-08-20): a draft with NO captured payment is hard-deleted —
// row and uploaded documents permanently removed — 24h after it goes idle.
// Applicants are responsible for finishing within that window; we hold
// nothing beyond it. Every path below that can delete first re-checks
// membership_payments (via isPaidNoApp / the draft's own payment columns) —
// a draft with real captured money is NEVER deleted here, it's routed to
// `payment_on_hold` for a human to recover or refund. Refunded drafts
// (Step 5) are a different lifecycle — they already had a real payment —
// and keep the prior soft-delete behavior; this policy is specifically
// about applicants who never paid at all.
//
// options.dryRun: returns the planned actions per draft without sending any
// email, writing any state, or logging any audit/step events.
// ---------------------------------------------------------------------------
export async function runCleanupDrafts(
  options: { dryRun?: boolean } = {},
): Promise<CleanupDraftsSummary> {
  const dryRun = options.dryRun ?? false

  const summary: CleanupDraftsSummary = {
    dry_run: dryRun,
    marked_stale: 0,
    expired: 0,
    hard_deleted: 0,
    payment_holds: 0,
    refunds_completed: 0,
    would_act_on: [],
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
    // Cutoff used by Step 3a, Step 3, Step 4 below.
    // 24h (was 48h until 2026-08-20): no payment made → deleted 24h after
    // going idle.
    //
    // 2026-08-21: removed the 5h/18h "complete your application" nudge
    // reminders entirely (explicit instruction — sending unsolicited nudges
    // to applicants who haven't finished reads as bothering people, not
    // helping them). The only email that survives is the 24h hard-delete's
    // "Application Cancelled" notice below, since that's reporting a real
    // action taken, not asking for anything. Deletion eligibility below no
    // longer depends on reminder_sent_at at all — it never fires anymore,
    // so gating deletion on "reminder sent ≥6h ago" would have permanently
    // stopped every future draft from ever being cleaned up. `updated_at
    // < 24h idle` is now the sole age gate, same as it always was for
    // marking a draft eligible in the first place.
    //
    // This also happens to fix a real production bug: the cron was timing
    // out at 60s on every run (Vercel Runtime Timeout, confirmed via
    // production logs, recurring since at least 2026-06-18) because the
    // reminder loops sent emails to the whole backlog sequentially before
    // ever reaching this hard-delete step. Removing them frees up the
    // budget for deletion to actually run.
    // -----------------------------------------------------------------------
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600000).toISOString()

    // -----------------------------------------------------------------------
    // Step 3a — Silent hard-delete for OTP-only drafts (no formData)
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
      .lt("updated_at", twentyFourHoursAgo)
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
        planAction(draft, "silent_hard_delete_no_formdata", `OTP-only abandoned, ${hoursIdle(draft.updated_at)}h idle, no formData persisted`)
        continue
      }
      try {
        // Atomic conditional delete — the WHERE clause is the race guard
        // (same role the prior conditional .update() played): if a payment
        // landed between the SELECT above and now, 0 rows match and this is
        // a no-op, same as the old "state changed during cleanup" skip.
        const { data: deletedRow } = await supabase
          .from("draft_applications")
          .delete()
          .eq("id", draft.id)
          .is("payment_order_id", null)
          .eq("has_verified_payment", false)
          .is("step_data->formData", null)
          .select("id, step_data")
          .maybeSingle()
        if (!deletedRow) { console.log(`[cleanup-drafts] skipped silent ${draft.id}: state changed during cleanup`); continue }
        const paths = extractStoragePaths((deletedRow as { step_data?: Record<string, unknown> }).step_data)
        if (paths.length > 0) {
          const { error: storageError } = await supabase.storage.from("uploads").remove(paths)
          if (storageError) console.error(`[cleanup-drafts] storage cleanup ${draft.id}:`, storageError.message)
        }
        await logMembershipAuditEvent({
          action: "draft_hard_deleted_no_formdata",
          entityType: "draft_application",
          entityId: draft.id,
          newData: {
            email: draft.email,
            phone: (draft as { phone?: string | null }).phone ?? null,
            step: draft.current_step,
            created_at: draft.created_at,
            reason: "Permanently deleted — no payment made, applicant verified email but never selected a membership type or filled the form (no step_data.formData)",
            step_data_snapshot: (draft as { step_data?: unknown }).step_data ?? null,
          },
          performedBy: "system",
        }, supabase)
        summary.hard_deleted++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] silent expire ${draft.id}:`, errMessage(err))
      }
    }

    // -----------------------------------------------------------------------
    // Step 3 — Hard-delete unpaid drafts (24h idle, no payment)
    // Row and uploaded documents are permanently removed — no retention
    // window (2026-08-20 policy change; previously a 48h soft-delete with
    // files kept 90 days). No reminder-based grace window (removed
    // 2026-08-21 alongside the nudge-email removal above) — `updated_at
    // < 24h idle` is the only age gate now.
    // -----------------------------------------------------------------------
    const { data: expiredDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment, created_at, step_data")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", twentyFourHoursAgo)
      .eq("has_verified_payment", false)
      .is("payment_order_id", null)
      .is("deleted_at", null)

    for (const draft of expiredDrafts || []) {
      // Safety: never delete-as-unpaid a draft that actually paid. The query
      // filters on the draft's own (unsynced) payment columns and would
      // otherwise delete a paid applicant and email them "payment not
      // completed". membership_payments is the source of truth.
      if (isPaidNoApp(draft.email)) {
        if (dryRun) planAction(draft, "skip_paid_no_submission", "captured payment in membership_payments — not unpaid; left as stuck/paid_no_submission for admin")
        continue
      }
      if (dryRun) {
        const why = isExcludedEmail(draft.email)
          ? `unpaid, ${hoursIdle(draft.updated_at)}h idle, excluded address (would hard-delete without emailing)`
          : `unpaid, ${hoursIdle(draft.updated_at)}h idle`
        planAction(draft, "hard_delete_unpaid", why)
        continue
      }
      try {
        const { data: deletedRow } = await supabase
          .from("draft_applications")
          .delete()
          .eq("id", draft.id)
          .is("payment_order_id", null)
          .eq("has_verified_payment", false)
          .select("id, step_data")
          .maybeSingle()
        if (!deletedRow) { console.log(`[cleanup-drafts] skipped ${draft.id}: payment arrived during deletion`); continue }
        const paths = extractStoragePaths((deletedRow as { step_data?: Record<string, unknown> }).step_data)
        if (paths.length > 0) {
          const { error: storageError } = await supabase.storage.from("uploads").remove(paths)
          if (storageError) console.error(`[cleanup-drafts] storage cleanup ${draft.id}:`, storageError.message)
        }
        if (!isExcludedEmail(draft.email)) {
          const html = emailWrapper(
            "Application Cancelled",
            `
            <p style="font-size:14px;color:#374151;margin:0 0 12px;">
              Your AMASI membership application has been cancelled because it was not
              completed within 24 hours of your last activity. You were on:
              <strong>${escapeHtml(stepLabel(draft.current_step))}</strong>.
            </p>
            <p style="font-size:14px;color:#374151;margin:0 0 12px;">
              No payment was made, so nothing further is owed. If you still wish to
              join, you're welcome to start a new application at any time.
            </p>
            <div style="margin:20px 0;text-align:center;">
              <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Start New Application</a>
            </div>
            `,
          )
          await resend!.emails.send({
            from: fromEmail,
            to: draft.email,
            subject: "Your AMASI membership application has been cancelled",
            html,
          })
        }
        await logMembershipAuditEvent({
          action: "draft_hard_deleted_unpaid",
          entityType: "draft_application",
          entityId: draft.id,
          newData: {
            email: draft.email,
            step: draft.current_step,
            reason: "Permanently deleted after 24h inactivity — no payment made",
            email_skipped: isExcludedEmail(draft.email) ? "excluded address" : null,
          },
          performedBy: "system",
        }, supabase)
        summary.hard_deleted++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] expire ${draft.id}:`, errMessage(err))
      }
    }

    // -----------------------------------------------------------------------
    // Step 4 — Paid-but-stuck drafts (24h idle, payment attempted)
    //   - Razorpay paid/captured → status=payment_on_hold + admin alert (manual refund) — NEVER deleted
    //   - Razorpay attempted → skip (may complete)
    //   - Else (order failed / never captured) → hard-delete (treat as unpaid)
    // -----------------------------------------------------------------------
    const { data: paidStuckDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment, created_at, step_data")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", twentyFourHoursAgo)
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
              // Safety: never delete-as-unpaid a draft that actually paid.
              // This branch's own Razorpay lookup keys on the draft's
              // payment_order_id, which is only the FIRST order attempted —
              // a failed order followed by a successful retry leaves this
              // column pointing at the dead order while a real payment sits
              // in membership_payments under a different order id. Steps 3
              // and 3a already guard on this; this branch never did, and
              // used to be shielded almost entirely by the reminder-grace
              // gate removed 2026-08-21 above. Matches Steps 3/3a exactly.
              if (isPaidNoApp(draft.email)) {
                if (dryRun) planAction(draft, "skip_paid_no_submission", "captured payment in membership_payments under a different order — not unpaid; left for admin")
                continue
              }
              // No reminder-based grace window (removed 2026-08-21 alongside
              // the nudge-email removal) — the outer query's 24h-idle filter
              // is already the age gate.
              if (dryRun) {
                const why = isExcludedEmail(draft.email)
                  ? `Razorpay status=${status}, excluded address (would hard-delete without emailing)`
                  : `Razorpay status=${status}, treating as unpaid`
                planAction(draft, "hard_delete_payment_failed", why)
                continue
              }
              if (!isExcludedEmail(draft.email)) {
                try {
                  await resend!.emails.send({
                    from: fromEmail,
                    to: draft.email,
                    subject: "Your AMASI membership application has been cancelled",
                    html: emailWrapper(
                      "Application Cancelled",
                      `
                      <p style="font-size:14px;color:#374151;">Dear Applicant,</p>
                      <p style="font-size:14px;color:#555;line-height:1.6;">
                        Your AMASI membership application started on ${draft.created_at ? new Date(draft.created_at).toLocaleDateString("en-IN") : "recently"}
                        has been cancelled because it was not completed within 24 hours of your
                        last activity, and payment was never completed.
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
              const { data: deletedRow } = await supabase
                .from("draft_applications")
                .delete()
                .eq("id", draft.id)
                .eq("has_verified_payment", false)
                .select("id, step_data")
                .maybeSingle()
              if (!deletedRow) { console.log(`[cleanup-drafts] skipped ${draft.id}: payment verified during deletion`); continue }
              const paths = extractStoragePaths((deletedRow as { step_data?: Record<string, unknown> }).step_data)
              if (paths.length > 0) {
                const { error: storageError } = await supabase.storage.from("uploads").remove(paths)
                if (storageError) console.error(`[cleanup-drafts] storage cleanup ${draft.id}:`, storageError.message)
              }
              await logMembershipAuditEvent({
                action: "draft_hard_deleted_unpaid",
                entityType: "draft_application",
                entityId: draft.id,
                newData: {
                  email: draft.email,
                  step: draft.current_step,
                  reason: "Permanently deleted after 24h inactivity — Razorpay order never reached paid/captured",
                  email_skipped: isExcludedEmail(draft.email) ? "excluded address" : null,
                },
                performedBy: "system",
              }, supabase)
              summary.hard_deleted++
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
    return summary
  } catch (error: unknown) {
    console.error("[cleanup-drafts] fatal error:", errMessage(error))
    throw error instanceof Error ? error : new Error(errMessage(error))
  }
}
