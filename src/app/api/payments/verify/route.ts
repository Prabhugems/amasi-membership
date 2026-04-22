import { NextRequest } from "next/server"
import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`payment-verify:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const body = await request.json()
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      referenceNumber,
      applicationId,
      amount,
      currency,
      email,
      membershipType,
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

    // Processing fee calculation
    const isILM = membershipType?.toUpperCase() === "ILM"
    const PROCESSING_FEE = isILM ? 0 : (Number(process.env.PROCESSING_FEE_INR) || 100)

    // Transfer is now handled at order creation (create-order route).
    // This verify route only logs the status — check the order for transfer details.
    let transferStatus: "success" | "failed" | "skipped" = "skipped"
    let transferError: string | null = null

    if (PROCESSING_FEE > 0) {
      try {
        const Razorpay = (await import("razorpay")).default
        const razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID!.trim(),
          key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
        })

        // Check if transfer was included in the order
        const order = await razorpay.orders.fetch(razorpay_order_id)
        if ((order as any).transfers?.items?.length > 0) {
          transferStatus = "success"
          console.log(`Route transfer via order: ₹${PROCESSING_FEE} for ${referenceNumber}`)
        } else {
          // Fallback: try payment-level transfer
          const EVENTS360_ACCOUNT_ID = process.env.EVENTS360_RAZORPAY_ACCOUNT_ID || "acc_SYV3ZpQvinGqOW"
          try {
            await (razorpay.payments as any).transfer(razorpay_payment_id, {
              transfers: [{
                account: EVENTS360_ACCOUNT_ID,
                amount: PROCESSING_FEE * 100,
                currency: "INR",
                notes: { reference: referenceNumber, purpose: "processing_fee" },
              }],
            })
            transferStatus = "success"
            console.log(`Route transfer via payment fallback: ₹${PROCESSING_FEE} for ${referenceNumber}`)
          } catch (fallbackErr: any) {
            transferStatus = "failed"
            transferError = fallbackErr?.error?.description || fallbackErr?.message || "Unknown error"
            console.error(`Route transfer FAILED for ${referenceNumber}:`, JSON.stringify({
              error: transferError,
              code: fallbackErr?.error?.code,
              paymentId: razorpay_payment_id,
              amount: PROCESSING_FEE,
            }))
          }
        }
      } catch (checkErr: any) {
        transferStatus = "failed"
        transferError = checkErr?.message || "Could not verify transfer"
        console.error(`Route transfer check error for ${referenceNumber}:`, checkErr.message)
      }
    }

    const supabase = createAdminClient()

    // Dedup check — prevent double-recording the same payment
    const { data: existingPayment } = await supabase
      .from("membership_payments")
      .select("id")
      .eq("gateway_payment_id", razorpay_payment_id)
      .limit(1)
      .maybeSingle()

    if (existingPayment) {
      return Response.json({ status: true, message: "Payment already recorded", paymentId: razorpay_payment_id })
    }

    // Record payment
    const { error: insertError } = await supabase.from("membership_payments").insert({
      application_id: applicationId || null,
      member_email: email || referenceNumber, // using as reference tracker
      gateway_order_id: razorpay_order_id,
      gateway_payment_id: razorpay_payment_id,
      gateway_signature: razorpay_signature,
      payment_gateway: "razorpay",
      status: "paid",
      amount: amount || null,
      currency: currency || "INR",
      fee_breakdown: {
        membership_fee: (amount || 4230) - PROCESSING_FEE,
        processing_fee: PROCESSING_FEE,
        processing_fee_account: PROCESSING_FEE > 0 ? "events360" : null,
        transfer_status: transferStatus,
        transfer_error: transferError,
        note: PROCESSING_FEE > 0 ? "₹100 processing fee (incl GST) to be settled to Events 360" : "No processing fee for ILM",
        applicant_email: email || null,
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
