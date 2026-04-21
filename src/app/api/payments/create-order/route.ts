import { NextRequest } from "next/server"
import Razorpay from "razorpay"
import { checkRateLimit } from "@/lib/rate-limit"

// Server-side fee lookup — source of truth for membership fees
const MEMBERSHIP_FEES: Record<string, { amount: number; currency: string }> = {
  LM:  { amount: 4230, currency: "INR" },
  ALM: { amount: 4230, currency: "INR" },
  ACM: { amount: 4230, currency: "INR" },
  ILM: { amount: 300,  currency: "USD" },
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`create-order:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const { amount, currency, referenceNumber, email, name, membershipType } = await request.json()

    if (!amount || !referenceNumber) {
      return Response.json({ status: false, message: "Amount and reference number required" }, { status: 400 })
    }

    // Validate membership type and amount
    const expectedFee = MEMBERSHIP_FEES[membershipType?.toUpperCase()]
    if (!expectedFee) {
      return Response.json({ status: false, message: "Invalid membership type" }, { status: 400 })
    }
    if (amount !== expectedFee.amount) {
      return Response.json({ status: false, message: `Invalid amount for ${membershipType} membership. Expected ${expectedFee.amount}` }, { status: 400 })
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!.trim(),
      key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
    })

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Razorpay expects paise
      currency: currency || "INR",
      receipt: referenceNumber,
      notes: {
        reference_number: referenceNumber,
        email,
        name,
        membership_type: membershipType,
      },
    })

    return Response.json({
      status: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
    })
  } catch (error: any) {
    console.error("Razorpay order error:", error)
    return Response.json({ status: false, message: "Payment could not be initiated. Please try again." }, { status: 500 })
  }
}
