import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

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

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const { draftId } = await request.json()

    if (!draftId) {
      return Response.json({ status: false, message: "Draft ID is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch draft application
    const { data: draft, error: fetchError } = await supabase
      .from("draft_applications")
      .select("*")
      .eq("id", draftId)
      .single()

    if (fetchError || !draft) {
      return Response.json({ status: false, message: "Draft application not found" }, { status: 404 })
    }

    if (draft.status !== "payment_on_hold") {
      return Response.json(
        { status: false, message: `Cannot refund a draft with status "${draft.status}". Expected "payment_on_hold".` },
        { status: 400 }
      )
    }

    if (!draft.payment_id) {
      return Response.json(
        { status: false, message: "No payment ID found on this draft application" },
        { status: 400 }
      )
    }

    // Initiate Razorpay refund
    let refund: any
    try {
      const Razorpay = (await import("razorpay")).default
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
      })

      refund = await (razorpay.payments as any).refund(draft.payment_id, {
        speed: "normal",
        notes: { reason: "Incomplete application refund", draft_id: draftId },
      })
    } catch (razorpayError: any) {
      console.error("Razorpay refund error:", razorpayError)

      // Log failed attempt to audit
      await supabase.from("membership_audit_log").insert({
        action: "refund_failed",
        target_type: "draft_application",
        target_id: draftId,
        details: {
          email: draft.email,
          payment_id: draft.payment_id,
          error: razorpayError.message || "Unknown Razorpay error",
        },
        performed_by: (session as any).email || "admin",
      }).then(({ error }) => {
        if (error) console.error("Audit log error:", error)
      })

      return Response.json(
        { status: false, message: razorpayError.message || "Failed to initiate refund with Razorpay" },
        { status: 500 }
      )
    }

    // Update draft status
    const { error: draftUpdateError } = await supabase
      .from("draft_applications")
      .update({ status: "refund_initiated", updated_at: new Date().toISOString() })
      .eq("id", draftId)

    if (draftUpdateError) {
      console.error("Draft update error:", draftUpdateError)
    }

    // Update or insert membership_payments
    const { data: existingPayment } = await supabase
      .from("membership_payments")
      .select("id")
      .eq("gateway_payment_id", draft.payment_id)
      .single()

    if (existingPayment) {
      await supabase
        .from("membership_payments")
        .update({ status: "refund_initiated", updated_at: new Date().toISOString() })
        .eq("gateway_payment_id", draft.payment_id)
    }
    // If no existing payment record, the refund is tracked via the draft and audit log

    // Send refund initiated email
    try {
      const resend = getResend()
      const stepData = (draft.step_data || {}) as Record<string, any>
      const fd = stepData.formData || {}
      const applicantName = escapeHtml(
        `${fd.salutation || "Dr."} ${fd.firstName || "Applicant"}`
      )
      const amountDisplay = fd.totalAmount ? `&#8377;${escapeHtml(String(fd.totalAmount))}` : "the paid amount"
      const refundId = escapeHtml(refund.id)

      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: draft.email,
        subject: "Refund initiated for your AMASI membership application",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
              <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
            </div>
            <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
              <p style="color: #374151; font-size: 15px;">Dear ${applicantName},</p>
              <p style="color: #555; font-size: 14px; line-height: 1.6;">
                A refund of <strong>${amountDisplay}</strong> has been initiated for your AMASI membership application.
                The amount will be credited back to your original payment method within <strong>5-7 business days</strong>.
              </p>
              <div style="background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 8px; padding: 16px; margin: 20px 0;">
                <p style="color: #0f766e; font-weight: 600; margin: 0 0 6px; font-size: 13px;">Refund Details</p>
                <p style="color: #115e59; font-size: 13px; margin: 0;">Razorpay Refund ID: <strong>${refundId}</strong></p>
              </div>
              <p style="color: #555; font-size: 14px; line-height: 1.6;">
                If you wish to apply again, you can start a fresh application using the link below.
              </p>
              <div style="text-align: center; margin: 28px 0 16px;">
                <a href="${escapeHtml(baseUrl)}/apply"
                   style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
                  Apply Again
                </a>
              </div>
              <p style="color: #555; font-size: 13px;">If you have questions, please contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Refund email error:", emailErr)
    }

    // Audit log
    await supabase.from("membership_audit_log").insert({
      action: "refund_initiated",
      target_type: "draft_application",
      target_id: draftId,
      details: {
        email: draft.email,
        payment_id: draft.payment_id,
        refund_id: refund.id,
      },
      performed_by: (session as any).email || "admin",
    }).then(({ error }) => {
      if (error) console.error("Audit log error:", error)
    })

    return Response.json({
      status: true,
      refundId: refund.id,
      message: "Refund initiated successfully",
    })
  } catch (error: any) {
    console.error("Refund error:", error)
    return Response.json(
      { status: false, message: error.message || "Failed to initiate refund. Please try again." },
      { status: 500 }
    )
  }
}
