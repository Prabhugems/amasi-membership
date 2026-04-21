import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`check-payment:${ip}`, 5, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many attempts. Please try again later." },
      { status: 429 }
    )
  }

  try {
    const email = request.nextUrl.searchParams.get("email")?.trim().toLowerCase()

    if (!email) {
      return Response.json(
        { status: false, message: "Email query parameter is required" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Find orphaned payments: paid but not linked to any application, within last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    const { data: orphanedPayments, error } = await supabase
      .from("membership_payments")
      .select("id, gateway_payment_id, gateway_order_id, amount, currency, member_email, created_at")
      .is("application_id", null)
      .eq("status", "paid")
      .gte("created_at", thirtyDaysAgo)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Error querying orphaned payments:", error)
      return Response.json(
        { status: false, message: "Failed to check payments" },
        { status: 500 }
      )
    }

    if (!orphanedPayments || orphanedPayments.length === 0) {
      return Response.json({ status: true, found: false })
    }

    // Check each orphaned payment's Razorpay order notes for email match
    const Razorpay = (await import("razorpay")).default
    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!.trim(),
      key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
    })

    for (const payment of orphanedPayments) {
      if (!payment.gateway_order_id) continue

      try {
        const order = await razorpay.orders.fetch(payment.gateway_order_id)
        const orderEmail = (order.notes as any)?.email?.toLowerCase()

        if (orderEmail === email) {
          return Response.json({
            status: true,
            found: true,
            payment: {
              id: payment.id,
              gateway_payment_id: payment.gateway_payment_id,
              gateway_order_id: payment.gateway_order_id,
              amount: payment.amount,
              currency: payment.currency,
              reference_number: payment.member_email,
              created_at: payment.created_at,
            },
          })
        }
      } catch (rzpError) {
        // Skip this payment if Razorpay fetch fails (e.g. invalid order ID)
        console.error(`Failed to fetch Razorpay order ${payment.gateway_order_id}:`, rzpError)
        continue
      }
    }

    return Response.json({ status: true, found: false })
  } catch (error: any) {
    console.error("Check existing payment error:", error)
    return Response.json(
      { status: false, message: "Failed to check for existing payments" },
      { status: 500 }
    )
  }
}
