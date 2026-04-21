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

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()
    const action = request.nextUrl.searchParams.get("action")

    // --- Counts mode ---
    if (action === "counts") {
      const { data, error } = await supabase
        .from("draft_applications")
        .select("status")

      if (error) {
        console.error("Draft counts error:", error)
        return Response.json({ status: false, message: "Failed to fetch counts" }, { status: 500 })
      }

      const rows = data || []
      const total = rows.length
      const in_progress = rows.filter((r) => r.status === "in_progress").length
      const stuck = rows.filter((r) => r.status === "stuck").length
      const payment_on_hold = rows.filter((r) => r.status === "payment_on_hold").length
      const refund_initiated = rows.filter((r) => r.status === "refund_initiated").length

      return Response.json({ total, in_progress, stuck, payment_on_hold, refund_initiated })
    }

    // --- List mode ---
    const status = request.nextUrl.searchParams.get("status") || "all"
    const search = request.nextUrl.searchParams.get("search")

    let query = supabase
      .from("draft_applications")
      .select("*")
      .order("created_at", { ascending: false })

    if (status === "all") {
      query = query.not("status", "in", '("completed","expired")')
    } else {
      query = query.eq("status", status)
    }

    if (search) {
      query = query.ilike("email", `%${search}%`)
    }

    const { data, error } = await query

    if (error) {
      console.error("List drafts error:", error)
      return Response.json({ status: false, message: "Failed to fetch drafts" }, { status: 500 })
    }

    return Response.json({ drafts: data || [] })
  } catch (error: any) {
    return Response.json({ status: false, message: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { action, draftId } = await request.json()

    if (!action || !draftId) {
      return Response.json(
        { status: false, message: "action and draftId are required" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // --- Delete action ---
    if (action === "delete") {
      const { data: draft, error: fetchError } = await supabase
        .from("draft_applications")
        .select("*")
        .eq("id", draftId)
        .single()

      if (fetchError || !draft) {
        return Response.json({ status: false, message: "Draft application not found" }, { status: 404 })
      }

      if (draft.has_verified_payment === true) {
        return Response.json(
          { status: false, message: "Cannot delete paid application. Initiate refund first." },
          { status: 400 }
        )
      }

      // Delete document files from storage
      try {
        const stepData = draft.step_data
        if (stepData && typeof stepData === "object") {
          const urls: string[] = []
          const extractUrls = (obj: any) => {
            if (!obj) return
            if (typeof obj === "string" && obj.includes("/storage/v1/object/")) {
              urls.push(obj)
            } else if (typeof obj === "object") {
              for (const val of Object.values(obj)) {
                extractUrls(val)
              }
            }
          }
          extractUrls(stepData)

          if (urls.length > 0) {
            const paths = urls
              .map((url) => {
                const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^?]+)/)
                if (match) {
                  const fullPath = match[1]
                  const slashIdx = fullPath.indexOf("/")
                  return { bucket: fullPath.substring(0, slashIdx), path: fullPath.substring(slashIdx + 1) }
                }
                return null
              })
              .filter(Boolean) as { bucket: string; path: string }[]

            for (const { bucket, path } of paths) {
              await supabase.storage.from(bucket).remove([path])
            }
          }
        }
      } catch (storageErr) {
        console.error("Storage cleanup error (non-fatal):", storageErr)
      }

      // Delete the draft row
      const { error: deleteError } = await supabase
        .from("draft_applications")
        .delete()
        .eq("id", draftId)

      if (deleteError) {
        console.error("Delete draft error:", deleteError)
        return Response.json({ status: false, message: "Failed to delete draft" }, { status: 500 })
      }

      // Audit log
      await supabase.from("membership_audit_log").insert({
        action: "draft_deleted",
        target_type: "draft_application",
        target_id: draftId,
        performed_by: (session as any).email || "admin",
      }).then(({ error }) => {
        if (error) console.error("Audit log error:", error)
      })

      return Response.json({ status: true, message: "Draft deleted successfully" })
    }

    // --- Send reminder action ---
    if (action === "send_reminder") {
      // Atomically claim the send — only proceed if reminder_sent_at is null
      // or older than 1 hour (prevent spam)
      const { data: claimed, error: claimError } = await supabase
        .from("draft_applications")
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq("id", draftId)
        .eq("status", "stuck")
        .or("reminder_sent_at.is.null,reminder_sent_at.lt." + new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .select("*")
        .maybeSingle()

      if (claimError) {
        console.error("Claim reminder error:", claimError)
        return Response.json({ status: false, message: "Failed to send reminder" }, { status: 500 })
      }

      if (!claimed) {
        return Response.json(
          { status: false, message: "Cannot send reminder — either the draft is not in 'stuck' status, or a reminder was already sent within the last hour." },
          { status: 400 }
        )
      }

      const draft = claimed
      const currentStep = draft.current_step || 1
      const stepLabel = escapeHtml(STEP_LABELS[currentStep] || `Step ${currentStep}`)
      const applicantEmail = draft.email

      const resend = getResend()
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: applicantEmail,
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
                We noticed your AMASI membership application is incomplete. You stopped at
                <strong>${stepLabel}</strong>.
              </p>
              <p style="color: #555; font-size: 14px; line-height: 1.6;">
                Your progress has been saved. Click the button below to pick up where you left off.
              </p>
              <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${escapeHtml(baseUrl)}/apply"
                   style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                  Resume Application
                </a>
              </div>
              <p style="color: #555; font-size: 13px;">If you have questions, please contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          </div>
        `,
      })

      // reminder_sent_at was already set atomically above
      return Response.json({ status: true, message: "Reminder sent successfully" })
    }

    // --- Resume action ---
    if (action === "resume") {
      const { data: draft, error: fetchError } = await supabase
        .from("draft_applications")
        .select("*")
        .eq("id", draftId)
        .single()

      if (fetchError || !draft) {
        return Response.json({ status: false, message: "Draft application not found" }, { status: 404 })
      }

      if (draft.status !== "payment_on_hold" && draft.status !== "stuck") {
        return Response.json(
          { status: false, message: `Cannot resume draft with status "${draft.status}".` },
          { status: 400 }
        )
      }

      // Reset status to in_progress so the user can continue
      const { error: updateError } = await supabase
        .from("draft_applications")
        .update({
          status: "in_progress",
          failure_reason: null,
          stale_since: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", draftId)

      if (updateError) {
        console.error("Resume draft error:", updateError)
        return Response.json({ status: false, message: "Failed to resume draft" }, { status: 500 })
      }

      // Send resume email to applicant
      try {
        const resend = getResend()
        const stepLabel = escapeHtml(STEP_LABELS[draft.current_step] || `Step ${draft.current_step}`)
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: draft.email,
          subject: "Your AMASI application is ready to resume",
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
                <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
                <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
              </div>
              <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
                <p style="color: #374151; font-size: 15px;">Dear Applicant,</p>
                <p style="color: #555; font-size: 14px; line-height: 1.6;">
                  Good news! The issue with your membership application has been resolved by our admin team.
                  You were on <strong>${stepLabel}</strong>. Please click below to resume.
                </p>
                <div style="text-align: center; margin: 28px 0 16px;">
                  <a href="${escapeHtml(baseUrl)}/apply"
                     style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                    Resume Application
                  </a>
                </div>
                <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
              </div>
            </div>
          `,
        })
      } catch (emailErr) {
        console.error("Resume email error:", emailErr)
      }

      // Audit log
      await supabase.from("membership_audit_log").insert({
        action: "draft_resumed",
        target_type: "draft_application",
        target_id: draftId,
        performed_by: (session as any).email || "admin",
      }).then(({ error }) => {
        if (error) console.error("Audit log error:", error)
      })

      return Response.json({ status: true, message: "Application resumed and applicant notified" })
    }

    return Response.json({ status: false, message: `Unknown action: ${action}` }, { status: 400 })
  } catch (error: any) {
    console.error("Incomplete applications POST error:", error)
    return Response.json(
      { status: false, message: error.message || "An unexpected error occurred" },
      { status: 500 }
    )
  }
}
