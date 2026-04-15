import { NextRequest } from "next/server"
import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get("x-razorpay-signature")

    if (!signature) {
      return Response.json({ error: "Missing signature" }, { status: 400 })
    }

    // Verify webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET
    if (!webhookSecret) {
      console.error("No Razorpay webhook secret configured")
      return Response.json({ error: "Server config error" }, { status: 500 })
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret.trim())
      .update(rawBody)
      .digest("hex")

    if (expectedSignature !== signature) {
      console.error("Razorpay webhook signature mismatch")
      return Response.json({ error: "Invalid signature" }, { status: 400 })
    }

    const event = JSON.parse(rawBody)
    const supabase = createAdminClient()

    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity
      if (!payment) return Response.json({ status: "ok" })

      const orderId = payment.order_id
      const paymentId = payment.id
      const amount = payment.amount / 100 // paise to rupees
      const referenceNumber = payment.notes?.reference_number

      // Check if payment already recorded (idempotency)
      const { data: existing } = await supabase
        .from("membership_payments")
        .select("id")
        .eq("gateway_payment_id", paymentId)
        .limit(1)

      if (existing && existing.length > 0) {
        return Response.json({ status: "already_processed" })
      }

      // Record payment
      await supabase.from("membership_payments").insert({
        member_email: referenceNumber || orderId,
        gateway_order_id: orderId,
        gateway_payment_id: paymentId,
        payment_gateway: "razorpay",
        status: "paid",
        amount,
        currency: payment.currency || "INR",
        source: "webhook",
      })

      // Update application if reference number present
      if (referenceNumber) {
        await supabase
          .from("membership_applications")
          .update({
            payment_status: "paid",
            payment_id: paymentId,
            updated_at: new Date().toISOString(),
          })
          .eq("reference_number", referenceNumber)
          .eq("payment_status", "pending")
      }

      console.log(`Webhook: payment.captured — ${paymentId} for ${referenceNumber}`)
    }

    if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity
      if (!payment) return Response.json({ status: "ok" })

      const referenceNumber = payment.notes?.reference_number
      if (referenceNumber) {
        await supabase
          .from("membership_applications")
          .update({
            payment_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("reference_number", referenceNumber)
          .eq("payment_status", "pending")
      }

      console.log(`Webhook: payment.failed — ${payment.id} for ${referenceNumber}`)
    }

    return Response.json({ status: "ok" })
  } catch (error: any) {
    console.error("Razorpay webhook error:", error)
    return Response.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
