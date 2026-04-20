import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { SignJWT, importPKCS8 } from "jose"

/* ------------------------------------------------------------------ */
/*  GET /api/card/wallet?id=<amasiNumber>&type=apple|google           */
/* ------------------------------------------------------------------ */
export async function GET(request: NextRequest) {
  const amasiNumber = request.nextUrl.searchParams.get("id")
  const walletType = request.nextUrl.searchParams.get("type")

  if (!amasiNumber || !walletType) {
    return Response.json(
      { error: "Missing id or type parameter" },
      { status: 400 },
    )
  }

  if (!["apple", "google"].includes(walletType)) {
    return Response.json(
      { error: "type must be 'apple' or 'google'" },
      { status: 400 },
    )
  }

  // Rate limit: 10 requests per 15 minutes per IP
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`wallet:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429 })
  }

  // Fetch member data
  try {
    const supabase = createAdminClient()
    const { data: member, error } = await supabase
      .from("members")
      .select("*")
      .eq("amasi_number", parseInt(amasiNumber))
      .single()

    if (error || !member) {
      return Response.json({ error: "Member not found" }, { status: 404 })
    }

    const mt = (member.membership_type || "").toLowerCase()
    const membershipLabel = mt.includes("life member [lm]") || mt === "lm"
      ? "Life Member"
      : mt.includes("associate life") || mt === "alm"
        ? "Associate Life Member"
        : mt.includes("candidate") || mt === "acm"
          ? "Associate Candidate Member"
          : mt.includes("international") || mt === "ilm"
            ? "International Life Member"
            : member.membership_type || "Member"

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"
    const verifyUrl = `${baseUrl}/verify?id=${member.amasi_number}`
    const memberName = member.name || "Member"

    /* -------------------------------------------------------------- */
    /*  Apple Wallet                                                   */
    /* -------------------------------------------------------------- */
    if (walletType === "apple") {
      const appleCert = process.env.APPLE_WALLET_CERT
      const appleKey = process.env.APPLE_WALLET_KEY

      if (!appleCert || !appleKey) {
        return Response.json(
          {
            error:
              "Apple Wallet requires Apple Developer certificate. Set APPLE_WALLET_CERT env var.",
            passJson: {
              formatVersion: 1,
              passTypeIdentifier: "pass.org.amasi.membership",
              serialNumber: `amasi-${member.amasi_number}`,
              teamIdentifier: "TEAM_ID",
              organizationName: "AMASI",
              description: "AMASI Membership Card",
              foregroundColor: "rgb(255, 255, 255)",
              backgroundColor: "rgb(13, 148, 136)",
              generic: {
                primaryFields: [
                  { key: "name", label: "Member", value: memberName },
                ],
                secondaryFields: [
                  { key: "number", label: "AMASI #", value: String(member.amasi_number) },
                  { key: "type", label: "Type", value: membershipLabel },
                ],
                backFields: [
                  { key: "verify", label: "Verify", value: verifyUrl },
                ],
              },
              barcode: {
                format: "PKBarcodeFormatQR",
                message: verifyUrl,
                messageEncoding: "iso-8859-1",
              },
            },
          },
          { status: 501 },
        )
      }

      // Future: generate signed .pkpass with Apple Developer certificates
      return Response.json(
        { error: "Apple Wallet pass generation not yet implemented" },
        { status: 501 },
      )
    }

    /* -------------------------------------------------------------- */
    /*  Google Wallet                                                  */
    /* -------------------------------------------------------------- */
    if (walletType === "google") {
      const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID
      const serviceAccountKeyB64 = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_KEY

      if (!issuerId || !serviceAccountKeyB64) {
        return Response.json(
          { error: "Google Wallet not configured", status: 501 },
          { status: 501 },
        )
      }

      let serviceAccountKey: { client_email: string; private_key: string }
      try {
        serviceAccountKey = JSON.parse(
          Buffer.from(serviceAccountKeyB64, "base64").toString("utf-8"),
        )
      } catch {
        return Response.json(
          { error: "Invalid GOOGLE_WALLET_SERVICE_ACCOUNT_KEY format" },
          { status: 500 },
        )
      }

      const payload = {
        iss: serviceAccountKey.client_email,
        aud: "google",
        typ: "savetowallet",
        origins: [baseUrl],
        payload: {
          genericObjects: [
            {
              id: `${issuerId}.amasi-${member.amasi_number}`,
              classId: `${issuerId}.amasi-membership`,
              genericType: "GENERIC_TYPE_UNSPECIFIED",
              hexBackgroundColor: "#0d9488",
              logo: {
                sourceUri: { uri: `${baseUrl}/icon.svg` },
              },
              cardTitle: {
                defaultValue: { language: "en", value: "AMASI" },
              },
              subheader: {
                defaultValue: { language: "en", value: "Membership Card" },
              },
              header: {
                defaultValue: { language: "en", value: memberName },
              },
              textModulesData: [
                {
                  id: "number",
                  header: "AMASI #",
                  body: String(member.amasi_number),
                },
                { id: "type", header: "Type", body: membershipLabel },
              ],
              barcode: { type: "QR_CODE", value: verifyUrl },
            },
          ],
        },
      }

      try {
        const privateKey = await importPKCS8(
          serviceAccountKey.private_key,
          "RS256",
        )

        const jwt = await new SignJWT(payload)
          .setProtectedHeader({ alg: "RS256", typ: "JWT" })
          .setIssuedAt()
          .sign(privateKey)

        const saveUrl = `https://pay.google.com/gp/v/save/${jwt}`

        return Response.json({ url: saveUrl })
      } catch (err) {
        console.error("Google Wallet JWT signing error:", err)
        return Response.json(
          { error: "Failed to generate Google Wallet pass" },
          { status: 500 },
        )
      }
    }

    return Response.json({ error: "Invalid wallet type" }, { status: 400 })
  } catch (err) {
    console.error("Wallet API error:", err)
    return Response.json(
      { error: "Unable to generate wallet pass. Please try again." },
      { status: 500 },
    )
  }
}
