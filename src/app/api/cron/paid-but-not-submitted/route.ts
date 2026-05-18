import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { Resend } from "resend"
import * as Sentry from "@sentry/nextjs"

interface StuckDraftRow {
  id: string
  email: string
  current_step: number
  payment_order_id: string | null
  payment_id: string | null
  updated_at: string
  created_at: string
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === "string") return e
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

// ---------------------------------------------------------------------------
// GET /api/cron/paid-but-not-submitted
//
// Hourly. Finds draft_applications with a verified payment that have not
// progressed for more than 1 hour (status=in_progress, has_verified_payment=true).
// These represent money captured but no membership application submitted —
// they need admin attention before the cleanup-drafts cron turns them into
// payment_on_hold rows.
//
// For each: fires a Sentry warning (fingerprinted by draft ID so duplicates
// collapse) and sends a single summary email to the admin address.
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const supabase = createAdminClient()
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString()

    const { data: stuckDrafts, error } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, payment_order_id, payment_id, updated_at, created_at")
      .eq("has_verified_payment", true)
      .eq("status", "in_progress")
      .lt("updated_at", oneHourAgo)
      .is("deleted_at", null)

    if (error) {
      console.error("[paid-but-not-submitted] query error:", error.message)
      return Response.json({ error: error.message }, { status: 500 })
    }

    const drafts = (stuckDrafts ?? []) as StuckDraftRow[]

    if (drafts.length === 0) {
      return Response.json({ status: "ok", count: 0 })
    }

    for (const draft of drafts) {
      const idleMinutes = Math.round(
        (Date.now() - new Date(draft.updated_at).getTime()) / 60000,
      )
      Sentry.captureMessage("[paid-but-not-submitted] draft stuck after payment", {
        level: "warning",
        fingerprint: ["paid-but-not-submitted", draft.id],
        tags: { component: "cron-paid-but-not-submitted" },
        extra: {
          draft_id: draft.id,
          email: draft.email,
          current_step: draft.current_step,
          payment_order_id: draft.payment_order_id,
          idle_minutes: idleMinutes,
        },
      })
    }

    const resendKey = process.env.RESEND_API_KEY?.trim()
    if (resendKey) {
      try {
        const resend = new Resend(resendKey)
        const fromEmail =
          process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"
        const adminEmail =
          process.env.ADMIN_ALERT_EMAIL?.trim() || "admin@amasi.org"

        const rows = drafts
          .map((d) => {
            const idleMin = Math.round(
              (Date.now() - new Date(d.updated_at as string).getTime()) / 60000,
            )
            return `<tr>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;font-size:12px;">${d.id}</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${d.email}</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">Step ${d.current_step}</td>
              <td style="padding:6px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;">${idleMin} min ago</td>
            </tr>`
          })
          .join("")

        await resend.emails.send({
          from: fromEmail,
          to: adminEmail,
          subject: `[AMASI] ${drafts.length} paid draft(s) stuck before submission`,
          html: `
            <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:24px;">
              <h2 style="margin:0 0 16px;font-size:18px;color:#111827;">Paid Drafts Stuck Before Submission</h2>
              <p style="color:#374151;font-size:14px;margin:0 0 16px;">
                The following draft applications have a verified payment but have not progressed
                in the last hour. Manual review may be required.
              </p>
              <table style="width:100%;border-collapse:collapse;font-size:14px;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Draft ID</th>
                    <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Email</th>
                    <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Step</th>
                    <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Idle</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
              <p style="color:#9ca3af;font-size:11px;margin-top:24px;">AMASI Membership — automated alert</p>
            </div>
          `,
        })
      } catch (emailErr: unknown) {
        console.error("[paid-but-not-submitted] admin email failed:", errMessage(emailErr))
      }
    }

    console.log(`[paid-but-not-submitted] ${drafts.length} stuck draft(s) reported`)
    return Response.json({
      status: "ok",
      count: drafts.length,
      draft_ids: drafts.map((d) => d.id),
    })
  } catch (error: unknown) {
    console.error("[paid-but-not-submitted] fatal error:", errMessage(error))
    Sentry.captureException(error, { tags: { component: "cron-paid-but-not-submitted" } })
    return Response.json({ error: "Cron failed" }, { status: 500 })
  }
}
