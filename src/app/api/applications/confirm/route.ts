import { NextRequest } from "next/server"
import { Resend } from "resend"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    const { email, name, referenceNumber, membershipType, fee } = await request.json()

    if (!email || !referenceNumber) {
      return Response.json({ status: false, message: "Missing required fields" }, { status: 400 })
    }

    const resend = getResend()

    const { error } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: email,
      subject: `AMASI Application Received — ${referenceNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
            <p style="color: #666; font-size: 14px; margin: 4px 0;">Association of Minimal Access Surgeons of India</p>
          </div>

          <h2 style="color: #1a1a1a;">Application Received</h2>
          <p style="color: #555;">Dear ${name || "Doctor"},</p>
          <p style="color: #555;">Your AMASI membership application has been submitted successfully.</p>

          <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 14px;">Reference Number</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right; font-size: 16px; color: #0f766e;">${referenceNumber}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 14px;">Membership Type</td>
                <td style="padding: 6px 0; text-align: right;">${membershipType}</td>
              </tr>
              ${fee ? `<tr>
                <td style="padding: 6px 0; color: #666; font-size: 14px;">Fee</td>
                <td style="padding: 6px 0; font-weight: bold; text-align: right;">${fee}</td>
              </tr>` : ""}
              <tr>
                <td style="padding: 6px 0; color: #666; font-size: 14px;">Status</td>
                <td style="padding: 6px 0; text-align: right;"><span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 13px;">Under Review</span></td>
              </tr>
            </table>
          </div>

          <p style="color: #555; font-size: 14px;">Save this reference number to track your application status. Our team will review your documents and notify you once approved.</p>

          <p style="color: #555; font-size: 14px;">You can check your application status at:<br>
          <a href="https://membership.amasi.org/apply/status?ref=${referenceNumber}" style="color: #0f766e;">Track Application Status</a></p>

          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
          <p style="color: #999; font-size: 12px; text-align: center;">
            Association of Minimal Access Surgeons of India<br>
            <a href="https://www.amasi.org" style="color: #999;">www.amasi.org</a>
          </p>
        </div>
      `,
    })

    if (error) {
      console.error("Confirmation email error:", error)
      return Response.json({ status: false, message: "Failed to send confirmation" }, { status: 500 })
    }

    return Response.json({ status: true, message: "Confirmation email sent" })
  } catch (error: any) {
    console.error("Confirm email error:", error)
    return Response.json({ status: false, message: "Failed to send confirmation" }, { status: 500 })
  }
}
