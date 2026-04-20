import { getAdminSession } from "@/lib/auth"
import { generateSecret, buildOtpauthUrl } from "@/lib/totp"
import QRCode from "qrcode"

export async function POST() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const email = session.email as string
    const secret = generateSecret()
    const otpauthUrl = buildOtpauthUrl(secret, email)

    // Generate QR code as a data URL
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      width: 256,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
    })

    return Response.json({
      status: true,
      secret,
      otpauthUrl,
      qrDataUrl,
    })
  } catch (error) {
    console.error("TOTP setup error:", error)
    return Response.json({ error: "Failed to generate TOTP secret" }, { status: 500 })
  }
}
