import { NextRequest } from "next/server"
import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase"

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      referenceNumber,
      applicationId,
      amount,
      currency,
    } = body as Record<string, any>

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return Response.json({ status: false, message: "Payment details missing" }, { status: 400 })
    }

    // Verify signature
    const signatureBody = razorpay_order_id + "|" + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!.trim())
      .update(signatureBody)
      .digest("hex")

    if (expectedSignature !== razorpay_signature) {
      console.error("Payment signature mismatch")
      return Response.json({ status: false, message: "Payment verification failed" }, { status: 400 })
    }

    // Transfer ₹100 processing fee to Events 360 via Razorpay Route
    const EVENTS360_ACCOUNT_ID = "acc_SYV3ZpQvinGqOW"
    const PROCESSING_FEE = 100 // INR, incl GST

    try {
      const Razorpay = (await import("razorpay")).default
      const razorpay = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID!.trim(),
        key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
      })

      await (razorpay.payments as any).transfer(razorpay_payment_id, {
        transfers: [{
          account: EVENTS360_ACCOUNT_ID,
          amount: PROCESSING_FEE * 100, // paise
          currency: "INR",
          notes: {
            reference: referenceNumber,
            purpose: "processing_fee",
          },
        }],
      })
    } catch (transferErr: any) {
      // Log but don't block — payment is already collected
      console.error("Route transfer error:", transferErr.message)
    }

    const supabase = createAdminClient()

    // Record payment
    const { error: insertError } = await supabase.from("membership_payments").insert({
      application_id: applicationId || null,
      member_email: referenceNumber, // using as reference tracker
      gateway_order_id: razorpay_order_id,
      gateway_payment_id: razorpay_payment_id,
      gateway_signature: razorpay_signature,
      payment_gateway: "razorpay",
      status: "paid",
      amount: amount || null,
      currency: currency || "INR",
      fee_breakdown: {
        membership_fee: (amount || 4230) - 100,
        processing_fee: 100,
        processing_fee_account: "events360",
        note: "₹100 processing fee (incl GST) to be settled to Events 360",
      },
    })

    if (insertError) {
      console.error("Payment insert error:", insertError)
      return Response.json({ status: false, message: "Failed to record payment" }, { status: 500 })
    }

    // Update application payment status
    if (applicationId) {
      const { error: updateError } = await supabase
        .from("membership_applications")
        .update({
          payment_status: "paid",
          payment_id: razorpay_payment_id,
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId)

      if (updateError) {
        console.error("Application payment status update error:", updateError)
      }
    }

    return Response.json({
      status: true,
      message: "Payment verified successfully",
      paymentId: razorpay_payment_id,
    })
  } catch (error: any) {
    console.error("Payment verify error:", error)
    return Response.json({ status: false, message: "Payment verification failed" }, { status: 500 })
  }
}
