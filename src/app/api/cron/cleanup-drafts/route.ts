import { createAdminClient } from "@/lib/supabase"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<number, string> = {
  1: "Select Membership Type",
  2: "Email Verification",
  3: "Document Upload",
  4: "Review Details",
  5: "Payment",
  6: "Submission",
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

function getBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "https://amasi-membership.vercel.app")
  )
}

function stepLabel(step: number): string {
  return STEP_LABELS[step] || `Step ${step}`
}

/**
 * Extract Supabase Storage paths from step_data JSONB.
 * Matches URLs containing `/storage/v1/object/` and extracts the
 * bucket-relative path for the `uploads` bucket.
 */
function extractStoragePaths(stepData: Record<string, unknown>): string[] {
  const paths: string[] = []
  const json = JSON.stringify(stepData)
  const regex = /\/storage\/v1\/object\/(?:sign|public)\/uploads\/([^?"]+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(json)) !== null) {
    paths.push(decodeURIComponent(match[1]))
  }
  return Array.from(new Set(paths))
}

/** Styled HTML email wrapper matching the project teal-gradient pattern. */
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

// ---------------------------------------------------------------------------
// GET /api/cron/cleanup-drafts
// Runs hourly. Cleans up stale / expired / stuck draft applications.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  // Auth: cron secret or admin session
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const summary = {
    marked_stale: 0,
    reminders_sent: 0,
    expired: 0,
    payment_holds: 0,
    refunds_completed: 0,
  }

  try {
    const supabase = createAdminClient()
    const resend = getResend()
    const baseUrl = getBaseUrl()
    const fromEmail =
      process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"

    // -----------------------------------------------------------------------
    // Step 1: Mark stale drafts
    // Find drafts where status = 'in_progress' AND updated_at < now() - 2h
    // -----------------------------------------------------------------------
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()

    const { data: staleDrafts } = await supabase
      .from("draft_applications")
      .select("id, current_step")
      .eq("status", "in_progress")
      .lt("updated_at", twoHoursAgo)

    if (staleDrafts && staleDrafts.length > 0) {
      for (const draft of staleDrafts) {
        const label = stepLabel(draft.current_step)
        const { error } = await supabase
          .from("draft_applications")
          .update({
            status: "stuck",
            stale_since: new Date().toISOString(),
            failure_reason: `Application inactive \u2014 user did not proceed past step ${escapeHtml(label)}`,
            updated_at: new Date().toISOString(),
          })
          .eq("id", draft.id)

        if (!error) summary.marked_stale++
        else console.error(`[cleanup-drafts] mark stale ${draft.id}:`, error.message)
      }
    }

    // -----------------------------------------------------------------------
    // Step 2: Send reminder emails
    // Stuck drafts where stale_since >= 1h old AND reminder_sent_at IS NULL
    // -----------------------------------------------------------------------
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString()

    const { data: reminderDrafts } = await supabase
      .from("draft_applications")
      .select("id, email, current_step")
      .eq("status", "stuck")
      .lt("stale_since", oneHourAgo)
      .is("reminder_sent_at", null)

    if (reminderDrafts && reminderDrafts.length > 0) {
      for (const draft of reminderDrafts) {
        const label = stepLabel(draft.current_step)
        const resumeUrl = `${baseUrl}/apply`

        const html = emailWrapper(
          "Complete Your Application",
          `
          <p style="font-size:14px;color:#374151;margin:0 0 12px;">
            Your membership application is incomplete. You were on: <strong>${escapeHtml(label)}</strong>.
          </p>
          <div style="margin:20px 0;text-align:center;">
            <a href="${escapeHtml(resumeUrl)}" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Resume Application</a>
          </div>
          <p style="font-size:12px;color:#6b7280;margin:12px 0 0;">
            If you no longer wish to apply, your application will be automatically removed after 24 hours.
          </p>
          `,
        )

        try {
          await resend.emails.send({
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
        } catch (err: any) {
          console.error(`[cleanup-drafts] reminder email ${draft.email}:`, err.message)
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 3: Expire unpaid drafts
    // Stuck > 24h, no payment
    // -----------------------------------------------------------------------
    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000,
    ).toISOString()

    const { data: expiredDrafts } = await supabase
      .from("draft_applications")
      .select("*")
      .eq("status", "stuck")
      .lt("stale_since", twentyFourHoursAgo)
      .eq("has_verified_payment", false)
      .is("payment_order_id", null)

    if (expiredDrafts && expiredDrafts.length > 0) {
      for (const draft of expiredDrafts) {
        try {
          // Send expiry email
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

          await resend.emails.send({
            from: fromEmail,
            to: draft.email,
            subject: "Your AMASI membership application has expired",
            html,
          })

          // Atomically mark for deletion — only succeeds if payment hasn't arrived
          const { data: markedForDelete } = await supabase
            .from("draft_applications")
            .update({ status: "expired" })
            .eq("id", draft.id)
            .is("payment_order_id", null)
            .eq("has_verified_payment", false)
            .select("id")
            .maybeSingle()

          if (!markedForDelete) {
            console.log(`[cleanup-drafts] skipped ${draft.id}: payment arrived during expiry`)
            continue
          }

          // Delete document files from storage (safe — payment guard passed)
          const paths = extractStoragePaths(draft.step_data || {})
          if (paths.length > 0) {
            const { error: storageError } = await supabase.storage
              .from("uploads")
              .remove(paths)
            if (storageError) {
              console.error(
                `[cleanup-drafts] storage cleanup ${draft.id}:`,
                storageError.message,
              )
            }
          }

          // Now safe to delete
          await supabase.from("draft_applications").delete().eq("id", draft.id)

          // Log to audit
          await supabase.from("membership_audit_log").insert({
            action: "draft_expired",
            target_type: "draft_application",
            target_id: draft.id,
            details: {
              email: draft.email,
              step: draft.current_step,
              reason: "Expired after 24h inactivity",
            },
            performed_by: "system",
          })

          summary.expired++
        } catch (err: any) {
          console.error(`[cleanup-drafts] expire ${draft.id}:`, err.message)
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 4: Check paid-but-stuck drafts
    // Stuck > 24h with payment info
    // -----------------------------------------------------------------------
    const { data: paidStuckDrafts } = await supabase
      .from("draft_applications")
      .select("*")
      .eq("status", "stuck")
      .lt("stale_since", twentyFourHoursAgo)
      .or("payment_order_id.not.is.null,has_verified_payment.eq.true")

    if (paidStuckDrafts && paidStuckDrafts.length > 0) {
      const Razorpay = (await import("razorpay")).default
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
      })

      for (const draft of paidStuckDrafts) {
        try {
          if (draft.payment_order_id) {
            const payment = await razorpay.orders.fetch(draft.payment_order_id)
            const status = (payment as any).status

            if (status === "paid" || status === "captured") {
              // Mark as payment_on_hold
              await supabase
                .from("draft_applications")
                .update({
                  status: "payment_on_hold",
                  has_verified_payment: true,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", draft.id)

              // Send admin alert to all active admins
              const { data: admins } = await supabase
                .from("admin_users")
                .select("email")
                .eq("is_active", true)

              if (admins && admins.length > 0) {
                const alertHtml = emailWrapper(
                  "Payment On Hold \u2014 Action Required",
                  `
                  <p style="font-size:14px;color:#374151;margin:0 0 12px;">
                    A paid draft application is stuck and requires manual review.
                  </p>
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
                  admins.map((admin) =>
                    resend.emails.send({
                      from: fromEmail,
                      to: admin.email,
                      subject: `Payment On Hold: ${draft.email}`,
                      html: alertHtml,
                    }),
                  ),
                )
              }

              summary.payment_holds++
            } else {
              // Payment not captured — treat as unpaid, expire and delete
              // Send expiry notification email
              try {
                await resend.emails.send({
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
                    <p style="font-size:14px;color:#555;line-height:1.6;">
                      You are welcome to apply again at any time.
                    </p>
                    <div style="text-align:center;margin:24px 0;">
                      <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Apply Again</a>
                    </div>
                    `,
                  ),
                })
              } catch (emailErr) {
                console.error(`[cleanup-drafts] expiry email (paid-uncaptured) ${draft.email}:`, emailErr)
              }

              // Atomically mark for deletion — only succeeds if payment hasn't been verified
              const { data: markedForDelete } = await supabase
                .from("draft_applications")
                .update({ status: "expired" })
                .eq("id", draft.id)
                .eq("has_verified_payment", false)
                .select("id")
                .maybeSingle()

              if (!markedForDelete) {
                console.log(`[cleanup-drafts] skipped ${draft.id}: payment verified during expiry`)
                continue
              }

              const paths = extractStoragePaths(draft.step_data || {})
              if (paths.length > 0) {
                await supabase.storage.from("uploads").remove(paths)
              }

              await supabase
                .from("draft_applications")
                .delete()
                .eq("id", draft.id)

              await supabase.from("membership_audit_log").insert({
                action: "draft_expired",
                target_type: "draft_application",
                target_id: draft.id,
                details: {
                  email: draft.email,
                  step: draft.current_step,
                  reason: "Expired after 24h inactivity — payment not captured",
                },
                performed_by: "system",
              })

              summary.expired++
            }
          } else {
            // has_verified_payment but no order_id — mark on hold
            await supabase
              .from("draft_applications")
              .update({
                status: "payment_on_hold",
                updated_at: new Date().toISOString(),
              })
              .eq("id", draft.id)

            summary.payment_holds++
          }
        } catch (err: any) {
          console.error(
            `[cleanup-drafts] paid-stuck check ${draft.id}:`,
            err.message,
          )
        }
      }
    }

    // -----------------------------------------------------------------------
    // Step 5: Check refund status
    // Drafts with status = 'refund_initiated'
    // -----------------------------------------------------------------------
    const { data: refundDrafts } = await supabase
      .from("draft_applications")
      .select("*")
      .eq("status", "refund_initiated")

    if (refundDrafts && refundDrafts.length > 0) {
      const Razorpay = (await import("razorpay")).default
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
      })

      for (const draft of refundDrafts) {
        try {
          if (!draft.payment_order_id && !draft.payment_id) continue

          // Check if the order or payment has been refunded
          let refunded = false

          if (draft.payment_order_id) {
            const order = await razorpay.orders.fetch(draft.payment_order_id)
            if ((order as any).status === "refunded") {
              refunded = true
            }
          }

          if (!refunded && draft.payment_id) {
            try {
              const paymentDetail = await razorpay.payments.fetch(
                draft.payment_id,
              )
              if ((paymentDetail as any).status === "refunded") {
                refunded = true
              }
            } catch {
              // Payment fetch failed — skip this round
            }
          }

          if (refunded) {
            // Send refund confirmation email
            const html = emailWrapper(
              "Refund Processed",
              `
              <p style="font-size:14px;color:#374151;margin:0 0 12px;">
                Your payment for the AMASI membership application has been refunded successfully.
              </p>
              <p style="font-size:14px;color:#374151;margin:0 0 12px;">
                If you wish to apply again in the future, you are welcome to start a new application.
              </p>
              <div style="margin:20px 0;text-align:center;">
                <a href="${escapeHtml(baseUrl)}/apply" style="display:inline-block;background:#0d9488;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Start New Application</a>
              </div>
              `,
            )

            await resend.emails.send({
              from: fromEmail,
              to: draft.email,
              subject: "AMASI membership application — refund processed",
              html,
            })

            // Clean up storage
            const paths = extractStoragePaths(draft.step_data || {})
            if (paths.length > 0) {
              await supabase.storage.from("uploads").remove(paths)
            }

            // Delete the draft
            await supabase
              .from("draft_applications")
              .delete()
              .eq("id", draft.id)

            // Audit log
            await supabase.from("membership_audit_log").insert({
              action: "draft_expired",
              target_type: "draft_application",
              target_id: draft.id,
              details: {
                email: draft.email,
                step: draft.current_step,
                reason: "Refund completed — draft removed",
              },
              performed_by: "system",
            })

            summary.refunds_completed++
          }
        } catch (err: any) {
          console.error(
            `[cleanup-drafts] refund check ${draft.id}:`,
            err.message,
          )
        }
      }
    }

    console.log("[cleanup-drafts] completed:", summary)
    return Response.json(summary)
  } catch (error: any) {
    console.error("[cleanup-drafts] fatal error:", error)
    return Response.json({ error: "Cleanup failed" }, { status: 500 })
  }
}
