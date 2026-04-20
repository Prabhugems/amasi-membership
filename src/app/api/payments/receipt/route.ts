import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

export async function GET(request: NextRequest) {
  // Rate limit: 10 requests per 15 minutes per IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`receipt:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return new Response("Too many requests. Please try again later.", { status: 429 })
  }

  const { searchParams } = request.nextUrl
  const paymentId = searchParams.get("id")
  const ref = searchParams.get("ref")

  if (!paymentId && !ref) {
    return new Response("Missing id or ref parameter.", { status: 400 })
  }

  try {
    const supabase = createAdminClient()

    // Fetch the payment record
    let query = supabase.from("membership_payments").select("*")
    if (paymentId) {
      query = query.eq("id", paymentId)
    } else {
      query = query.eq("member_email", ref!)
    }
    const { data: payments, error: paymentError } = await query.limit(1).single()

    if (paymentError || !payments) {
      return new Response("Payment not found.", { status: 404 })
    }

    const payment = payments as Record<string, any>

    // Fetch associated application for member name and AMASI number
    let memberName = ""
    let amasiNumber = ""
    let membershipType = ""

    if (payment.application_id) {
      const { data: app } = await supabase
        .from("membership_applications")
        .select("name, reference_number, membership_type")
        .eq("id", payment.application_id)
        .single()

      if (app) {
        memberName = (app as any).name || ""
        membershipType = (app as any).membership_type || ""
      }
    }

    // Also try to find the member record via application_no (= reference number)
    const refNumber = payment.member_email || ref || ""
    if (!memberName && refNumber) {
      const { data: member } = await supabase
        .from("members")
        .select("name, amasi_number, membership_type")
        .eq("application_no", refNumber)
        .limit(1)
        .single()

      if (member) {
        memberName = (member as any).name || ""
        amasiNumber = String((member as any).amasi_number || "")
        membershipType = membershipType || (member as any).membership_type || ""
      }
    }

    // Parse fee breakdown
    const feeBreakdown = payment.fee_breakdown || {}
    const membershipFee = feeBreakdown.membership_fee ?? null
    const processingFee = feeBreakdown.processing_fee ?? null

    // Format date
    const paymentDate = payment.created_at
      ? new Date(payment.created_at).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "long",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      : "N/A"

    const currency = payment.currency || "INR"
    const currencySymbol = currency === "INR" ? "₹" : currency + " "
    const amount = payment.amount != null ? Number(payment.amount) : null
    const receiptNumber = payment.gateway_payment_id || payment.id || "N/A"
    const membershipLabel = formatMembershipType(membershipType)

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AMASI Payment Receipt — ${receiptNumber}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #f5f5f5; }
    .receipt-container { max-width: 680px; margin: 24px auto; background: #fff; border-radius: 12px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); color: #fff; padding: 32px 40px; text-align: center; }
    .header h1 { font-size: 22px; font-weight: 700; letter-spacing: 1px; margin-bottom: 4px; }
    .header p { font-size: 13px; opacity: 0.8; }
    .logo-text { font-size: 28px; font-weight: 800; letter-spacing: 2px; margin-bottom: 8px; }
    .body { padding: 32px 40px; }
    .receipt-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #e8e8e8; }
    .receipt-title h2 { font-size: 18px; color: #1a1a2e; }
    .receipt-badge { background: #dcfce7; color: #166534; font-size: 12px; font-weight: 600; padding: 4px 12px; border-radius: 20px; }
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 32px; margin-bottom: 28px; }
    .info-item label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; margin-bottom: 4px; }
    .info-item p { font-size: 14px; font-weight: 500; }
    .divider { border: none; border-top: 1px dashed #d1d5db; margin: 24px 0; }
    .fee-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .fee-table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; font-weight: 600; padding: 8px 0; border-bottom: 1px solid #e5e7eb; }
    .fee-table td { padding: 10px 0; font-size: 14px; border-bottom: 1px solid #f3f4f6; }
    .fee-table td:last-child, .fee-table th:last-child { text-align: right; }
    .total-row td { font-weight: 700; font-size: 16px; border-bottom: none; border-top: 2px solid #1a1a2e; padding-top: 12px; }
    .footer { padding: 20px 40px; background: #fafafa; border-top: 1px solid #e8e8e8; text-align: center; }
    .footer p { font-size: 11px; color: #9ca3af; line-height: 1.6; }
    .print-btn { display: block; margin: 16px auto 0; background: #1a1a2e; color: #fff; border: none; padding: 10px 28px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: background 0.2s; }
    .print-btn:hover { background: #16213e; }
    @media print {
      body { background: #fff; }
      .receipt-container { box-shadow: none; margin: 0; border-radius: 0; }
      .print-btn { display: none !important; }
      .no-print { display: none !important; }
    }
    @media (max-width: 600px) {
      .body, .header, .footer { padding-left: 20px; padding-right: 20px; }
      .info-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="receipt-container">
    <div class="header">
      <div class="logo-text">AMASI</div>
      <h1>Association of Minimal Access Surgeons of India</h1>
      <p>Official Membership Payment Receipt</p>
    </div>

    <div class="body">
      <div class="receipt-title">
        <h2>Payment Receipt</h2>
        <span class="receipt-badge">${escapeHtml(payment.status === "paid" ? "PAID" : String(payment.status || "").toUpperCase())}</span>
      </div>

      <div class="info-grid">
        <div class="info-item">
          <label>Receipt Number</label>
          <p style="font-family: monospace;">${escapeHtml(String(receiptNumber))}</p>
        </div>
        <div class="info-item">
          <label>Date of Payment</label>
          <p>${escapeHtml(paymentDate)}</p>
        </div>
        ${memberName ? `<div class="info-item">
          <label>Member Name</label>
          <p>${escapeHtml(memberName)}</p>
        </div>` : ""}
        ${amasiNumber ? `<div class="info-item">
          <label>AMASI Number</label>
          <p style="font-family: monospace;">#${escapeHtml(amasiNumber)}</p>
        </div>` : ""}
        ${membershipLabel ? `<div class="info-item">
          <label>Membership Type</label>
          <p>${escapeHtml(membershipLabel)}</p>
        </div>` : ""}
        <div class="info-item">
          <label>Payment Method</label>
          <p>Razorpay (Online)</p>
        </div>
        ${refNumber ? `<div class="info-item">
          <label>Reference Number</label>
          <p style="font-family: monospace;">${escapeHtml(String(refNumber))}</p>
        </div>` : ""}
      </div>

      <hr class="divider" />

      <table class="fee-table">
        <thead>
          <tr><th>Description</th><th>Amount</th></tr>
        </thead>
        <tbody>
          ${membershipFee != null ? `<tr>
            <td>Membership Fee</td>
            <td>${currencySymbol}${Number(membershipFee).toLocaleString("en-IN")}</td>
          </tr>` : ""}
          ${processingFee != null ? `<tr>
            <td>Processing Fee (incl. GST)</td>
            <td>${currencySymbol}${Number(processingFee).toLocaleString("en-IN")}</td>
          </tr>` : ""}
          ${membershipFee == null && processingFee == null && amount != null ? `<tr>
            <td>Membership Payment</td>
            <td>${currencySymbol}${amount.toLocaleString("en-IN")}</td>
          </tr>` : ""}
          <tr class="total-row">
            <td>Total Paid</td>
            <td>${amount != null ? `${currencySymbol}${amount.toLocaleString("en-IN")}` : "N/A"}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="footer">
      <p>This is a computer-generated receipt and does not require a physical signature.</p>
      <p style="margin-top: 4px;">AMASI &mdash; Association of Minimal Access Surgeons of India</p>
    </div>

    <div class="no-print" style="padding: 0 40px 24px; text-align: center;">
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>
</body>
</html>`

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    })
  } catch (error: any) {
    console.error("Receipt generation error:", error)
    return new Response("Failed to generate receipt.", { status: 500 })
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function formatMembershipType(type: string): string {
  if (!type) return ""
  const map: Record<string, string> = {
    LM: "Life Member",
    ALM: "Associate Life Member",
    ACM: "Associate Candidate Member",
    ILM: "International Life Member",
  }
  return map[type.toUpperCase()] || type
}
