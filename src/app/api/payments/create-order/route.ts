import { NextRequest } from "next/server"
import Razorpay from "razorpay"

export async function POST(request: NextRequest) {
  try {
    const { amount, currency, referenceNumber, email, name, membershipType } = await request.json()

    if (!amount || !referenceNumber) {
      return Response.json({ status: false, message: "Amount and reference number required" }, { status: 400 })
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
    return Response.json({ status: false, message: error.message || "Failed to create order" }, { status: 500 })
  }
}
