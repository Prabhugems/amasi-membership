// @auth: public — legacy mobile shim. Razorpay payment finalize.
//
// CRITICAL SECURITY NOTE (closes legacy /final_step's fraud surface):
//
// The legacy backend trusted `payment_status: "Success"` from the client and
// flipped the application to approved with no cryptographic check. The
// Flutter v1.0.4+2 binary does NOT forward `razorpay_signature` or
// `razorpay_order_id` as named form fields (see migration/MIGRATION_FINDINGS.md
// §3), so we cannot do the canonical HMAC verify
// (`createHmac("sha256", secret).update(order_id|payment_id) === signature`).
//
// Instead this route uses the Razorpay Orders/Payments API as the source of
// truth. The client's `payment_status` and `payment_json` are IGNORED.
//
// 1. Look up the draft's `payment_order_id` (set by /create_order).
// 2. razorpay.orders.fetch(order_id) — confirm order exists and matches.
// 3. razorpay.payments.fetch(payment_id) — confirm payment is captured AND
//    its `order_id` field equals the draft's `payment_order_id` AND its
//    `amount` matches the expected fee.
// 4. Only then mark the draft as paid + record into membership_payments.
//
// This catches the legacy fraud (client claims success but no payment was
// captured). It does NOT catch the subtler "I paid for someone else's
// order, replay another payment_id" attack — that requires the HMAC
// signature which the in-stores binary doesn't ship. Documented as
// follow-up requiring a Flutter release.
//
// See migration/SHIM_README.md "Razorpay signature verification".

import type { NextRequest } from "next/server"
import Razorpay from "razorpay"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { APPLICATION_TYPES } from "@/app/api/get_application/route"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export const maxDuration = 30

interface RazorpayOrder {
  id: string
  amount: number | string
  currency: string
  status: string
  receipt?: string
}

interface RazorpayPayment {
  id: string
  order_id: string
  amount: number | string
  currency: string
  status: string
  method?: string
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-final-step:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many requests")
    }

    const form = await parseLegacyForm(request)
    const draftId = field(form, "id").trim()
    const paymentId = field(form, "payment_id").trim()
    const clientClaimedStatus = field(form, "payment_status").trim() // IGNORED — see note above

    if (!draftId) {
      return legacyErr("Member not found")
    }

    const supabase = createAdminClient()

    const { data: draft } = await supabase
      .from("draft_applications")
      .select(
        "id, email, membership_type, payment_order_id, step_data, has_verified_payment"
      )
      .eq("id", draftId)
      .maybeSingle()
    if (!draft) return legacyErr("Member not found")

    const orderId = draft.payment_order_id as string | null
    if (!orderId) {
      return legacyErr("No payment order on file. Please retry the payment.")
    }

    // Client claimed "Failed" — record but don't verify against Razorpay
    // (Razorpay won't have a captured payment in that case anyway). Allow
    // retry from the Flutter app's Track Application screen.
    if (clientClaimedStatus.toLowerCase() === "failed" || !paymentId) {
      Sentry.captureMessage("shim/final_step: client reported failure", {
        level: "info",
        tags: { route: "shim/final_step", reason: "client_failure" },
        extra: { draftId, orderId },
      })
      return legacyErr("Payment failed. Please retry.")
    }

    const typeKey = (draft.membership_type as string)?.toUpperCase()
    const appType = APPLICATION_TYPES.find((t) => t.typeKey === typeKey)
    if (!appType) {
      return legacyErr("Invalid membership type on draft")
    }
    const expectedAmountPaise = Math.round(appType.fee * 100)
    const expectedCurrency = appType.currency_code

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!.trim(),
      key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
    })

    // 1. Fetch order
    let order: RazorpayOrder
    try {
      order = (await razorpay.orders.fetch(orderId)) as unknown as RazorpayOrder
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "shim/final_step", op: "orders_fetch" },
        extra: { draftId, orderId },
      })
      return legacyErr("Could not verify order with Razorpay. Please try again.")
    }

    const orderAmount = typeof order.amount === "string" ? parseInt(order.amount, 10) : order.amount
    if (order.id !== orderId || orderAmount !== expectedAmountPaise || order.currency !== expectedCurrency) {
      Sentry.captureMessage("shim/final_step: order mismatch", {
        level: "warning",
        tags: { route: "shim/final_step", reason: "order_mismatch" },
        extra: { draftId, orderId, expectedAmountPaise, expectedCurrency, actual: order },
      })
      return legacyErr("Payment verification failed.")
    }

    // 2. Fetch payment + verify it belongs to this order and is captured
    let payment: RazorpayPayment
    try {
      payment = (await razorpay.payments.fetch(paymentId)) as unknown as RazorpayPayment
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: "shim/final_step", op: "payments_fetch" },
        extra: { draftId, orderId, paymentId },
      })
      return legacyErr("Could not verify payment with Razorpay. Please try again.")
    }

    const paymentAmount = typeof payment.amount === "string" ? parseInt(payment.amount, 10) : payment.amount

    const verifyOk =
      payment.order_id === orderId &&
      payment.status === "captured" &&
      paymentAmount === expectedAmountPaise &&
      payment.currency === expectedCurrency

    if (!verifyOk) {
      Sentry.captureMessage("shim/final_step: payment verification failed", {
        level: "warning",
        tags: { route: "shim/final_step", reason: "payment_verify_failed" },
        extra: {
          draftId,
          orderId,
          paymentId,
          expectedAmountPaise,
          expectedCurrency,
          paymentSummary: {
            order_id: payment.order_id,
            amount: payment.amount,
            currency: payment.currency,
            status: payment.status,
          },
        },
      })
      return legacyErr("Payment verification failed.")
    }

    const existingStepData = (draft.step_data || {}) as Record<string, unknown>
    const referenceNumber = (existingStepData.reference_number as string) || orderId

    // 3. Record payment (idempotent via gateway_payment_id unique index).
    const { error: paymentInsertErr } = await supabase
      .from("membership_payments")
      .upsert(
        {
          application_id: null,
          member_email: draft.email,
          gateway_order_id: orderId,
          gateway_payment_id: paymentId,
          gateway_signature: null, // can't capture from this binary — see route comment
          payment_gateway: "razorpay",
          status: "paid",
          amount: appType.fee,
          currency: appType.currency_code,
          fee_breakdown: {
            membership_fee: appType.fee,
            processing_fee: 0, // shim doesn't split processing fee — events360 transfer is a /apply-flow feature
            source: "mobile_v1_shim",
            verified_via: "razorpay_orders_payments_api",
            client_claimed_status: clientClaimedStatus,
          },
        },
        { onConflict: "gateway_payment_id", ignoreDuplicates: true }
      )
    if (paymentInsertErr) {
      Sentry.captureException(paymentInsertErr, {
        level: "fatal",
        tags: { route: "shim/final_step", op: "membership_payments_upsert" },
        extra: { draftId, orderId, paymentId },
      })
      return legacyErr("Failed to record payment")
    }

    // 4. Mark draft as paid.
    const { error: draftUpdateErr } = await supabase
      .from("draft_applications")
      .update({
        has_verified_payment: true,
        payment_id: paymentId,
        step_data: {
          ...existingStepData,
          reference_number: referenceNumber,
          paid_at: new Date().toISOString(),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)
    if (draftUpdateErr) {
      Sentry.captureException(draftUpdateErr, {
        level: "fatal",
        tags: { route: "shim/final_step", op: "draft_update" },
        extra: { draftId, paymentId },
      })
      return legacyErr("Failed to update draft")
    }

    // Legacy shape: { status, message, user_id, application_no }. We return
    // reference_number as application_no. The application has NOT been
    // submitted yet — that's handled out-of-band by admin or a follow-up
    // submission flow. See SHIM_README.md "Submission gap."
    return legacyOk("Member updated successfully", {
      user_id: draftId,
      application_no: referenceNumber,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/final_step" } })
    return legacyErr("Something went wrong")
  }
}
