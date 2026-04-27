/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction, logMembershipAuditEvent } from "@/lib/audit-log"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

// Always use the branded domain for customer-facing URLs — see incomplete/route.ts.
const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://membership.amasi.org"

// ─── Application refund ──────────────────────────────────────────────────────

async function refundApplication(
  applicationId: string,
  reason: string,
  adminEmail: string,
  adminName?: string,
) {
  const supabase = createAdminClient()

  const { data: app, error: appError } = await supabase
    .from("membership_applications")
    .select("id, email, reference_number, payment_id, payment_status, membership_type, first_name, last_name, salutation")
    .eq("id", applicationId)
    .single()

  if (appError || !app) {
    return Response.json({ status: false, message: "Application not found" }, { status: 404 })
  }

  if (!app.payment_id) {
    return Response.json({ status: false, message: "No payment recorded on this application" }, { status: 400 })
  }

  if (app.payment_status === "refunded") {
    // Already refunded — return the existing refund_id from membership_payments
    const { data: payment } = await supabase
      .from("membership_payments")
      .select("refund_id")
      .eq("gateway_payment_id", app.payment_id)
      .maybeSingle()
    return Response.json({
      status: true,
      alreadyRefunded: true,
      refundId: payment?.refund_id ?? null,
      message: "Payment was already refunded",
    })
  }

  if (app.payment_status !== "paid") {
    return Response.json(
      { status: false, message: `Cannot refund — payment_status is "${app.payment_status}", expected "paid"` },
      { status: 400 },
    )
  }

  // Fetch the payment record for amount / idempotency check
  const { data: paymentRow } = await supabase
    .from("membership_payments")
    .select("id, amount, currency, fee_breakdown, refund_id")
    .eq("gateway_payment_id", app.payment_id)
    .maybeSingle()

  // Hard precondition: no payment row means we cannot determine the amount or check idempotency
  if (!paymentRow) {
    Sentry.captureException(new Error(`Refund attempted on application ${app.id} with no membership_payments row`))
    return Response.json({ status: false, message: "No payment record found for this application. Reconcile manually." }, { status: 400 })
  }

  // Idempotency guard: real refund ID already set — treat as success.
  // 'pending' falls through to the atomic claim below (concurrent in-progress).
  if (paymentRow.refund_id && paymentRow.refund_id !== "pending") {
    return Response.json({
      status: true,
      alreadyRefunded: true,
      refundId: paymentRow.refund_id,
      message: "Payment was already refunded",
    })
  }

  // Determine refund amount — membership fee only (exclude ₹100 processing fee for INR)
  const totalAmount = paymentRow.amount ?? 0
  const currency = paymentRow.currency ?? "INR"
  const feeBreakdown = paymentRow.fee_breakdown as Record<string, any> | null

  let refundAmount: number
  if (currency === "INR") {
    // Prefer the persisted membership_fee from fee_breakdown; fall back to total - 100
    const membershipFee = feeBreakdown?.membership_fee ?? (totalAmount - 100)
    refundAmount = membershipFee
  } else {
    // ILM (USD) — no processing fee, refund in full
    refundAmount = totalAmount
  }

  if (refundAmount <= 0) {
    return Response.json({ status: false, message: "Calculated refund amount is zero or negative" }, { status: 400 })
  }

  // Atomic claim: set refund_id='pending' only if still null — closes the
  // TOCTOU race between concurrent admin clicks / Razorpay webhook retries.
  const { data: claimRows, error: claimError } = await supabase
    .from("membership_payments")
    .update({ refund_id: "pending" })
    .eq("gateway_payment_id", app.payment_id)
    .is("refund_id", null)
    .select("id")

  if (claimError) {
    Sentry.captureException(claimError)
    return Response.json({ status: false, message: "Refund claim failed" }, { status: 500 })
  }

  if (!claimRows || claimRows.length === 0) {
    // Already claimed by a concurrent caller
    return Response.json({ status: true, message: "Refund already in progress or completed" }, { status: 200 })
  }

  // Initiate Razorpay refund
  let refund: any
  try {
    const Razorpay = (await import("razorpay")).default
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!.trim(),
      key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
    })

    refund = await (razorpay.payments as any).refund(app.payment_id, {
      amount: Math.round(refundAmount * 100), // paise / cents
      speed: "normal",
      notes: {
        reason,
        application_id: applicationId,
        reference_number: app.reference_number,
        refunded_by: adminEmail,
      },
    })
  } catch (razorpayError: any) {
    // Reset claim so a future retry can reclaim — do NOT leave 'pending' stuck
    const { error: resetErr } = await supabase
      .from("membership_payments")
      .update({ refund_id: null })
      .eq("gateway_payment_id", app.payment_id)
      .eq("refund_id", "pending")
    if (resetErr) console.error("Failed to reset refund claim:", resetErr)

    Sentry.captureException(razorpayError, {
      tags: { flow: "application_refund" },
      extra: { applicationId, adminEmail },
    })
    console.error("Razorpay refund error:", razorpayError)

    await logMembershipAuditEvent({
      action: "refund_failed",
      entityType: "membership_application",
      entityId: applicationId,
      newData: {
        email: app.email,
        payment_id: app.payment_id,
        error: razorpayError.message || "Unknown Razorpay error",
      },
      performedBy: adminEmail,
    }, supabase)

    return Response.json(
      { status: false, message: razorpayError.message || "Failed to initiate refund with Razorpay" },
      { status: 500 },
    )
  }

  const now = new Date().toISOString()

  // Update membership_payments
  if (paymentRow?.id) {
    const { error: pmErr } = await supabase
      .from("membership_payments")
      .update({
        status: "refunded",
        refund_id: refund.id,
        refunded_at: now,
        refund_reason: reason,
        updated_at: now,
      })
      .eq("id", paymentRow.id)
      .throwOnError()

    if (pmErr) {
      // This branch is unreachable after throwOnError but satisfies TS
      console.error("membership_payments update error:", pmErr)
    }
  }

  // Update membership_applications payment_status
  await supabase
    .from("membership_applications")
    .update({ payment_status: "refunded", updated_at: now })
    .eq("id", applicationId)
    .throwOnError()

  // Audit: admin_audit_log (admin-initiated)
  await logAdminAction({
    adminEmail,
    adminName,
    action: "refund_payment",
    entityType: "membership_application",
    entityId: applicationId,
    entityName: app.reference_number,
    details: {
      payment_id: app.payment_id,
      refund_id: refund.id,
      refund_amount: refundAmount,
      currency,
      reason,
    },
  })

  // Audit: membership_audit_log (lifecycle event)
  await logMembershipAuditEvent({
    action: "refund_issued",
    entityType: "membership_application",
    entityId: applicationId,
    newData: {
      email: app.email,
      payment_id: app.payment_id,
      refund_id: refund.id,
      refund_amount: refundAmount,
      currency,
      reason,
    },
    performedBy: adminEmail,
  }, supabase)

  // Send refund email to applicant
  try {
    const resend = getResend()
    const applicantName = escapeHtml(
      [app.salutation || "Dr.", app.first_name || "Applicant"].filter(Boolean).join(" "),
    )
    const amountDisplay =
      currency === "USD"
        ? `$${escapeHtml(String(refundAmount))}`
        : `&#8377;${escapeHtml(String(refundAmount))}`
    const refundId = escapeHtml(refund.id)
    const ref = escapeHtml(app.reference_number || applicationId)
    const escapedReason = escapeHtml(reason)

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: app.email,
      subject: "Your AMASI membership application payment has been refunded",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
            <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
          </div>
          <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
            <p style="color: #374151; font-size: 15px;">Dear ${applicantName},</p>
            <p style="color: #555; font-size: 14px; line-height: 1.6;">
              Your AMASI membership application payment of <strong>${amountDisplay}</strong> has been refunded.
              The amount will be credited back to your original payment method within <strong>5–7 business days</strong>.
            </p>
            <div style="background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: #9a3412; font-weight: 600; margin: 0 0 8px; font-size: 13px;">Refund Details</p>
              <p style="color: #7c2d12; font-size: 13px; margin: 0 0 4px;">Application Reference: <strong>${ref}</strong></p>
              <p style="color: #7c2d12; font-size: 13px; margin: 0 0 4px;">Razorpay Refund ID: <strong>${refundId}</strong></p>
              <p style="color: #7c2d12; font-size: 13px; margin: 0;">Reason: ${escapedReason}</p>
            </div>
            <p style="color: #555; font-size: 13px;">If you have questions, please contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
          </div>
        </div>
      `,
    })
  } catch (emailErr) {
    // Non-fatal — refund already processed
    console.error("Refund email error:", emailErr)
  }

  return Response.json({
    status: true,
    refundId: refund.id,
    refundAmount,
    currency,
    message: `Refund of ${currency === "USD" ? "$" : "₹"}${refundAmount} initiated successfully. The applicant will receive a confirmation email.`,
  })
}

// ─── Draft refund (original) ─────────────────────────────────────────────────

async function refundDraft(draftId: string, adminEmail: string, supabase: ReturnType<typeof createAdminClient>) {
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
      { status: 400 },
    )
  }

  if (!draft.payment_id) {
    return Response.json(
      { status: false, message: "No payment ID found on this draft application" },
      { status: 400 },
    )
  }

  // Atomic claim: transition status 'payment_on_hold' → 'refund_pending' only
  // if still in 'payment_on_hold' — closes the TOCTOU race.
  const { data: claimRows, error: claimError } = await supabase
    .from("draft_applications")
    .update({ status: "refund_pending" })
    .eq("id", draftId)
    .eq("status", "payment_on_hold")
    .select("id")

  if (claimError) {
    Sentry.captureException(claimError)
    return Response.json({ status: false, message: "Refund claim failed" }, { status: 500 })
  }

  if (!claimRows || claimRows.length === 0) {
    // Already claimed by a concurrent caller
    return Response.json({ status: true, message: "Refund already in progress or completed" }, { status: 200 })
  }

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
    // Reset claim so a future retry can reclaim — do NOT leave 'refund_pending' stuck
    const { error: resetErr } = await supabase
      .from("draft_applications")
      .update({ status: "payment_on_hold" })
      .eq("id", draftId)
      .eq("status", "refund_pending")
    if (resetErr) console.error("Failed to reset refund claim:", resetErr)

    Sentry.captureException(razorpayError, {
      tags: { flow: "draft_refund" },
      extra: { draftId, adminEmail },
    })
    console.error("Razorpay refund error:", razorpayError)

    await logMembershipAuditEvent({
      action: "refund_failed",
      entityType: "draft_application",
      entityId: draftId,
      newData: {
        email: draft.email,
        payment_id: draft.payment_id,
        error: razorpayError.message || "Unknown Razorpay error",
      },
      performedBy: adminEmail,
    }, supabase)

    return Response.json(
      { status: false, message: razorpayError.message || "Failed to initiate refund with Razorpay" },
      { status: 500 },
    )
  }

  const { error: draftUpdateError } = await supabase
    .from("draft_applications")
    .update({ status: "refund_initiated", updated_at: new Date().toISOString() })
    .eq("id", draftId)

  if (draftUpdateError) {
    console.error("Draft update error:", draftUpdateError)
    return Response.json(
      {
        status: false,
        message: `Refund initiated (ID: ${refund.id}) but failed to update draft status. Please reconcile manually.`,
        refundId: refund.id,
      },
      { status: 500 },
    )
  }

  const { data: existingPayment } = await supabase
    .from("membership_payments")
    .select("id")
    .eq("gateway_payment_id", draft.payment_id)
    .single()

  if (existingPayment) {
    await supabase
      .from("membership_payments")
      .update({ status: "refund_initiated", refund_id: refund.id, updated_at: new Date().toISOString() })
      .eq("gateway_payment_id", draft.payment_id)
  }

  try {
    const resend = getResend()
    const stepData = (draft.step_data || {}) as Record<string, any>
    const fd = stepData.formData || {}
    const applicantName = escapeHtml(`${fd.salutation || "Dr."} ${fd.firstName || "Applicant"}`)
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

  await logMembershipAuditEvent({
    action: "refund_initiated",
    entityType: "draft_application",
    entityId: draftId,
    newData: {
      email: draft.email,
      payment_id: draft.payment_id,
      refund_id: refund.id,
    },
    performedBy: adminEmail,
  }, supabase)

  return Response.json({
    status: true,
    refundId: refund.id,
    message: "Refund initiated successfully",
  })
}

// ─── Route handler ───────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

    const body = await request.json()
    const { applicationId, draftId, reason } = body

    if (!applicationId && !draftId) {
      return Response.json({ status: false, message: "applicationId or draftId is required" }, { status: 400 })
    }

    if (applicationId) {
      if (!reason?.trim()) {
        return Response.json({ status: false, message: "Reason is required for application refunds" }, { status: 400 })
      }
      return refundApplication(
        applicationId,
        reason.trim(),
        (session as any).email || "admin",
        (session as any).name,
      )
    }

    // Legacy draft refund path
    const supabase = createAdminClient()
    return refundDraft(draftId, (session as any).email || "admin", supabase)
  } catch (error: any) {
    Sentry.captureException(error, { tags: { flow: "application_refund" } })
    console.error("Refund error:", error)
    return Response.json(
      { status: false, message: error.message || "Failed to initiate refund. Please try again." },
      { status: 500 },
    )
  }
}
