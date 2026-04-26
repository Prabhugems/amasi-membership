import { createAdminClient } from "@/lib/supabase"
import { escapeHtml } from "@/lib/html-escape"
import { logMembershipAuditEvent } from "@/lib/audit-log"
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

export async function GET(request: Request) {
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
      if (dryRun) { planAction(draft, "mark_stale", "in_progress >2h idle"); continue }
      const { error } = await supabase
        .from("draft_applications")
        .update({
          status: "stuck",
          stale_since: new Date().toISOString(),
          failure_reason: `Application inactive — user did not proceed past step ${escapeHtml(stepLabel(draft.current_step))}`,
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
    // Step 2 — Single reminder at 18h-from-updated_at
    //   Replaces the prior 1h-after-stuck logic.
    // -----------------------------------------------------------------------
    const eighteenHoursAgo = new Date(Date.now() - 18 * 3600000).toISOString()
    const { data: reminderDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", eighteenHoursAgo)
      .is("reminder_sent_at", null)
      .is("deleted_at", null)

    for (const draft of reminderDrafts || []) {
      if (dryRun) {
        planAction(draft, "send_reminder_18h", `${hoursIdle(draft.updated_at)}h idle, no prior reminder`)
        continue
      }
      const html = emailWrapper(
        "Complete Your Application",
        `
        <p style="font-size:14px;color:#374151;margin:0 0 12px;">
          Your membership application is incomplete. You were on: <strong>${escapeHtml(stepLabel(draft.current_step))}</strong>.
        </p>
        <div style="margin:20px 0;text-align:center;">
          <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Resume Application</a>
        </div>
        <p style="font-size:12px;color:#6b7280;margin:12px 0 0;">
          If you no longer wish to apply, your application will be removed after 24 hours of further inactivity.
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
        summary.reminders_sent++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] reminder email ${draft.email}:`, errMessage(err))
      }
    }

    // -----------------------------------------------------------------------
    // Step 3 — Soft-delete unpaid drafts (24h idle, no payment)
    // Files in storage are KEPT for the 90-day audit window.
    // -----------------------------------------------------------------------
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 3600000).toISOString()
    const { data: expiredDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment, created_at")
      .in("status", ["in_progress", "stuck"])
      .lt("updated_at", twentyFourHoursAgo)
      .eq("has_verified_payment", false)
      .is("payment_order_id", null)
      .is("deleted_at", null)

    for (const draft of expiredDrafts || []) {
      if (dryRun) { planAction(draft, "soft_delete_unpaid", `unpaid, ${hoursIdle(draft.updated_at)}h idle`); continue }
      try {
        const { data: marked } = await supabase
          .from("draft_applications")
          .update({ status: "expired", deleted_at: new Date().toISOString() })
          .eq("id", draft.id)
          .is("payment_order_id", null)
          .eq("has_verified_payment", false)
          .select("id")
          .maybeSingle()
        if (!marked) { console.log(`[cleanup-drafts] skipped ${draft.id}: payment arrived during expiry`); continue }
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
        await logMembershipAuditEvent({
          action: "draft_expired",
          entityType: "draft_application",
          entityId: draft.id,
          newData: { email: draft.email, step: draft.current_step, reason: "Soft-deleted after 24h inactivity (files retained)" },
          performedBy: "system",
        }, supabase)
        summary.expired++
      } catch (err: unknown) {
        console.error(`[cleanup-drafts] expire ${draft.id}:`, errMessage(err))
      }
    }

    // -----------------------------------------------------------------------
    // Step 4 — Paid-but-stuck drafts (24h idle, payment present)
    //   - Razorpay paid/captured → status=payment_on_hold + admin alert (manual refund)
    //   - Razorpay attempted → skip (may complete)
    //   - Else → soft-delete (treat as unpaid)
    // -----------------------------------------------------------------------
    const { data: paidStuckDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, status, updated_at, payment_order_id, payment_id, has_verified_payment, created_at")
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
                .update({ status: "payment_on_hold", has_verified_payment: true, updated_at: new Date().toISOString() })
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
              if (dryRun) { planAction(draft, "soft_delete_payment_failed", `Razorpay order status=${status}, treating as unpaid`); continue }
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
                      Your AMASI membership application started on ${new Date(draft.created_at).toLocaleDateString("en-IN")}
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
              const { data: marked } = await supabase
                .from("draft_applications")
                .update({ status: "expired", deleted_at: new Date().toISOString() })
                .eq("id", draft.id)
                .eq("has_verified_payment", false)
                .select("id")
                .maybeSingle()
              if (!marked) { console.log(`[cleanup-drafts] skipped ${draft.id}: payment verified during expiry`); continue }
              await logMembershipAuditEvent({
                action: "draft_expired",
                entityType: "draft_application",
                entityId: draft.id,
                newData: { email: draft.email, step: draft.current_step, reason: "Soft-deleted after 24h inactivity — payment not captured (files retained)" },
                performedBy: "system",
              }, supabase)
              summary.expired++
            }
          } else {
            // has_verified_payment but no order_id → mark on hold
            if (dryRun) { planAction(draft, "flag_payment_on_hold", "has_verified_payment=true but no order_id"); continue }
            await supabase
              .from("draft_applications")
              .update({ status: "payment_on_hold", updated_at: new Date().toISOString() })
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
            if (dryRun) { planAction(draft, "soft_delete_refund_completed", "Razorpay confirms refund completed"); continue }
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
            await supabase
              .from("draft_applications")
              .update({ status: "expired", deleted_at: new Date().toISOString() })
              .eq("id", draft.id)
            await logMembershipAuditEvent({
              action: "draft_refunded",
              entityType: "draft_application",
              entityId: draft.id,
              newData: { email: draft.email, step: draft.current_step, reason: "Refund completed — soft-deleted (files retained)" },
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
