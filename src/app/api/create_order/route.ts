// @auth: public — legacy mobile shim. Creates a Razorpay order from a draft.
// Looks up the draft's membership_type, gets the canonical fee from
// APPLICATION_TYPES (mirrors MEMBERSHIP_FEES in payments/create-order),
// creates the order via the Razorpay SDK using OUR server-side keys (the
// shim does NOT trust client-supplied amounts).
//
// Critically: this route does NOT replicate the full payments/create-order
// flow (document gate, duplicate-payment guard, orphan-payment guard). The
// shim's intent is "restore service for the in-stores binary"; the legacy
// backend had none of these gates either. The downstream final_step
// performs server-side verify against the Razorpay API so a forged
// payment_status: "Success" can't auto-approve the application.
//
// See migration/backend-spec.md §30.

import type { NextRequest } from "next/server"
import Razorpay from "razorpay"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { generateRefNumber } from "@/lib/reference-number"
import { APPLICATION_TYPES } from "@/app/api/get_application/route"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export const maxDuration = 20

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-create-order:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many requests")
    }

    const form = await parseLegacyForm(request)
    const draftId = field(form, "member_id").trim() || field(form, "id").trim()
    if (!draftId) return legacyErr("Member not found")

    const supabase = createAdminClient()
    const { data: draft } = await supabase
      .from("draft_applications")
      .select("id, email, membership_type, step_data, payment_order_id, has_verified_payment")
      .eq("id", draftId)
      .maybeSingle()
    if (!draft) return legacyErr("Member not found")
    if (draft.has_verified_payment) {
      return legacyErr("Payment already completed for this application.")
    }

    const typeKey = (draft.membership_type as string)?.toUpperCase()
    const appType = APPLICATION_TYPES.find((t) => t.typeKey === typeKey)
    if (!appType) {
      Sentry.captureMessage("shim/create_order: unknown membership_type", {
        level: "warning",
        tags: { route: "shim/create_order", reason: "unknown_type" },
        extra: { draftId, typeKey },
      })
      return legacyErr("Invalid membership type")
    }

    const amount = appType.fee
    const currency = appType.currency_code

    const referenceNumber = generateRefNumber()

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!.trim(),
      key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
    })

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise/cents
      currency,
      receipt: referenceNumber,
      partial_payment: false,
      notes: {
        reference_number: referenceNumber,
        email: draft.email as string,
        membership_type: typeKey,
        source: "mobile_v1_shim",
      },
    })

    // Persist order_id + reference on the draft so /final_step can verify
    // against Razorpay rather than trusting the client.
    const existingStepData = (draft.step_data || {}) as Record<string, unknown>
    await supabase
      .from("draft_applications")
      .update({
        payment_order_id: order.id,
        step_data: {
          ...existingStepData,
          reference_number: referenceNumber,
          razorpay_amount: amount,
          razorpay_currency: currency,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)

    // Legacy shape: { status, id, currency, amount, receipt }
    // Razorpay SDK returns amount in paise; legacy returned major units —
    // Flutter multiplies by 100 again in member_application.dart:112
    // (`amount: applicationController.createOrderData.value.amount! * 100`).
    // So we mirror legacy and return the major-unit value.
    return legacyOk("Order created", {
      id: order.id,
      currency,
      amount,
      receipt: referenceNumber,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/create_order" } })
    return legacyErr("Order could not be created. Please try again.")
  }
}
