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

    // Debug: log env vars presence
    console.log("[zoho/callback] CLIENT_ID exists:", !!process.env.ZOHO_CLIENT_ID)
    console.log("[zoho/callback] CLIENT_SECRET exists:", !!process.env.ZOHO_CLIENT_SECRET)
    console.log("[zoho/callback] REDIRECT_URI:", process.env.ZOHO_REDIRECT_URI)
    console.log("[zoho/callback] Code:", code.substring(0, 20) + "...")

    const tokens = await exchangeCode(code)
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()

    const supabase = createAdminClient()

    // Upsert tokens — always store under 'default' key
    await supabase.from("zoho_tokens").upsert({
      id: "default",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })

    return NextResponse.redirect(new URL("/admin?zoho=connected", request.url))
  } catch (error: any) {
    console.error("[zoho/callback] Error:", error)
    // Return JSON error for debugging — change to redirect once working
    return Response.json({
      error: error.message || "Unknown error",
      hint: "Check ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REDIRECT_URI env vars on Vercel",
    }, { status: 500 })
  }
}
