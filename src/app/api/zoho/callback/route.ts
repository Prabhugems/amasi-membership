import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { exchangeCode } from "@/lib/zoho"

export async function GET(request: NextRequest) {
  try {
    // No admin session check — this is an OAuth redirect from Zoho
    // Security is provided by the authorization code itself
    const code = request.nextUrl.searchParams.get("code")
    if (!code) {
      return NextResponse.redirect(new URL("/admin?zoho=error&reason=no_code", request.url))
    }

    // Get the accounts-server from the callback URL (Zoho sends it)
    const accountsServer = request.nextUrl.searchParams.get("accounts-server") || "https://accounts.zoho.in"

    // Exchange code for tokens directly here (bypass zoho.ts for debugging)
    const clientId = process.env.ZOHO_CLIENT_ID
    const clientSecret = process.env.ZOHO_CLIENT_SECRET
    const redirectUri = process.env.ZOHO_REDIRECT_URI

    console.log("[zoho/callback] accounts-server:", accountsServer)
    console.log("[zoho/callback] clientId:", clientId?.substring(0, 20))
    console.log("[zoho/callback] redirectUri:", redirectUri)

    const tokenUrl = `${accountsServer}/oauth/v2/token`
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: redirectUri!,
        code,
      }),
    })

    const tokenText = await tokenRes.text()
    console.log("[zoho/callback] Token response:", tokenRes.status, tokenText.substring(0, 300))

    let tokenData: any
    try {
      tokenData = JSON.parse(tokenText)
    } catch {
      return Response.json({
        error: `Zoho returned HTML (status ${tokenRes.status})`,
        tokenUrl,
        clientId: clientId?.substring(0, 20),
        redirectUri,
        responsePreview: tokenText.substring(0, 200),
      }, { status: 500 })
    }

    if (tokenData.error) {
      return Response.json({ error: tokenData.error, description: tokenData.error_description || "" }, { status: 400 })
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString()

    const supabase = createAdminClient()
    await supabase.from("zoho_tokens").upsert({
      id: "default",
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })

    return NextResponse.redirect(new URL("/?zoho=connected", request.url))
  } catch (error: any) {
    console.error("[zoho/callback] Error:", error)
    return Response.json({
      error: error.message || "Unknown error",
      stack: error.stack?.substring(0, 300),
    }, { status: 500 })
  }
}
