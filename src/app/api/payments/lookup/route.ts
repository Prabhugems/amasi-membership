import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

export async function POST(request: NextRequest) {
  // Rate limit: 5 lookups per 15 minutes per IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`payment-lookup:${ip}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many attempts. Please try again later." }, { status: 429 })
  }

  try {
    const { paymentId } = await request.json()

    if (!paymentId || typeof paymentId !== "string") {
      return Response.json({ status: false, message: "Payment ID is required" }, { status: 400 })
    }

    const trimmed = paymentId.trim()
    if (!trimmed.startsWith("pay_")) {
      return Response.json({ status: false, message: "Invalid Razorpay payment ID format. It should start with 'pay_'" }, { status: 400 })
    }

    // Check if already recorded in our system
    const supabase = createAdminClient()
    const { data: existing } = await supabase
      .from("membership_payments")
      .select("id, status, gateway_payment_id, member_email, application_id, amount, created_at")
      .eq("gateway_payment_id", trimmed)
      .limit(1)
      .maybeSingle()

    if (existing && existing.status === "paid") {
      return Response.json({
        status: true,
        already_recorded: true,
        message: "This payment is already recorded and verified in our system.",
        payment: {
          id: existing.gateway_payment_id,
          amount: existing.amount,
          status: "paid",
          reference: existing.member_email,
          recorded_at: existing.created_at,
        },
      })
    }

    // Fetch from Razorpay API
    const keyId = process.env.RAZORPAY_KEY_ID?.trim()
    const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()

    if (!keyId || !keySecret) {
      return Response.json({ status: false, message: "Payment gateway not configured" }, { status: 500 })
    }

    const authHeader = Buffer.from(`${keyId}:${keySecret}`).toString("base64")
    const rzpRes = await fetch(`https://api.razorpay.com/v1/payments/${trimmed}`, {
      headers: { Authorization: `Basic ${authHeader}` },
    })

    if (!rzpRes.ok) {
      if (rzpRes.status === 404) {
        return Response.json({ status: false, message: "Payment not found in Razorpay. Please check the payment ID." }, { status: 404 })
      }
      return Response.json({ status: false, message: "Unable to verify with Razorpay. Please try again." }, { status: 502 })
    }

    const rzpPayment = await rzpRes.json()
    const isCaptured = rzpPayment.status === "captured"
    const isAuthorized = rzpPayment.status === "authorized"
    const isPaid = isCaptured || isAuthorized

    if (!isPaid) {
      return Response.json({
        status: false,
        message: `Payment found but status is "${rzpPayment.status}". Only captured/authorized payments can be verified.`,
        razorpay_status: rzpPayment.status,
      })
    }

    // Payment is valid — record it and update application
    const amountInr = rzpPayment.amount ? rzpPayment.amount / 100 : null
    const email = rzpPayment.email || rzpPayment.notes?.email || null
    const phone = rzpPayment.contact || rzpPayment.notes?.phone || null
    const referenceNumber = rzpPayment.notes?.referenceNumber || rzpPayment.notes?.reference || null
    const orderId = rzpPayment.order_id || null

    // Try to find matching application
    let applicationId: string | null = null
    if (referenceNumber) {
      const { data: app } = await supabase
        .from("membership_applications")
        .select("id")
        .eq("reference_number", referenceNumber)
        .limit(1)
        .maybeSingle()
      applicationId = app?.id || null
    }

    // If no reference, try by email
    if (!applicationId && email) {
      const { data: app } = await supabase
        .from("membership_applications")
        .select("id")
        .ilike("email", email)
        .in("payment_status", ["pending", "failed", ""])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      applicationId = app?.id || null
    }

    // Record payment if not already exists
    if (!existing) {
      await supabase.from("membership_payments").insert({
        application_id: applicationId,
        member_email: referenceNumber || email || phone || trimmed,
        gateway_order_id: orderId,
        gateway_payment_id: trimmed,
        gateway_signature: null,
        payment_gateway: "razorpay",
        status: "paid",
        amount: amountInr,
        currency: rzpPayment.currency || "INR",
        fee_breakdown: {
          note: "Verified via payment lookup",
          total: amountInr,
        },
      })
    }

    // Update application if found
    if (applicationId) {
      await supabase
        .from("membership_applications")
        .update({
          payment_status: "paid",
          payment_id: trimmed,
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId)
    }

    return Response.json({
      status: true,
      already_recorded: false,
      message: applicationId
        ? "Payment verified and application updated successfully!"
        : "Payment verified! However, we couldn't match it to an application automatically. Please contact support with your payment ID.",
      payment: {
        id: trimmed,
        amount: amountInr,
        currency: rzpPayment.currency || "INR",
        status: "paid",
        email,
        phone,
        reference: referenceNumber,
        razorpay_status: rzpPayment.status,
        application_linked: !!applicationId,
      },
    })
  } catch (error: any) {
    console.error("Payment lookup error:", error)
    return Response.json({ status: false, message: "Payment verification failed. Please try again." }, { status: 500 })
  }
}
