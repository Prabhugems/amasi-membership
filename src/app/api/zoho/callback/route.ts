import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { exchangeCode } from "@/lib/zoho"

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return NextResponse.redirect(new URL("/admin/login", request.url))
    }

    const code = request.nextUrl.searchParams.get("code")
    if (!code) {
      return NextResponse.redirect(new URL("/admin?zoho=error&reason=no_code", request.url))
    }

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
    return NextResponse.redirect(
      new URL(`/admin?zoho=error&reason=${encodeURIComponent(error.message || "unknown")}`, request.url),
    )
  }
}
