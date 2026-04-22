import { createAdminClient } from "@/lib/supabase"

const ZOHO_AUTH_DOMAIN = "https://accounts.zoho.in"
const ZOHO_API_BASE = "https://campaigns.zoho.in/api/v1.1"
const ZOHO_SCOPES =
  "ZohoCampaigns.contact.READ,ZohoCampaigns.contact.UPDATE,ZohoCampaigns.campaign.READ,ZohoCampaigns.campaign.UPDATE"

// --- OAuth helpers ---

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    scope: ZOHO_SCOPES,
    client_id: process.env.ZOHO_CLIENT_ID!,
    response_type: "code",
    access_type: "offline",
    redirect_uri: process.env.ZOHO_REDIRECT_URI!,
    prompt: "consent",
  })
  return `${ZOHO_AUTH_DOMAIN}/oauth/v2/auth?${params.toString()}`
}

export async function exchangeCode(code: string) {
  const res = await fetch(`${ZOHO_AUTH_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      redirect_uri: process.env.ZOHO_REDIRECT_URI!,
      code,
    }),
  })

  const text = await res.text()
  console.log("[zoho] Token exchange response:", res.status, text.substring(0, 300))

  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error(`Zoho returned non-JSON (status ${res.status}): ${text.substring(0, 200)}`)
  }
  if (data.error) throw new Error(`Zoho OAuth error: ${data.error}`)

  return {
    access_token: data.access_token as string,
    refresh_token: data.refresh_token as string,
    expires_in: data.expires_in as number, // seconds
  }
}

export async function refreshAccessToken(refreshToken: string) {
  const res = await fetch(`${ZOHO_AUTH_DOMAIN}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ZOHO_CLIENT_ID!,
      client_secret: process.env.ZOHO_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(`Zoho refresh error: ${data.error}`)

  return {
    access_token: data.access_token as string,
    expires_in: data.expires_in as number,
  }
}

/**
 * Get a valid access token, refreshing if expired.
 * Returns null if no tokens are stored (Zoho not connected).
 */
export async function getAccessToken(): Promise<string | null> {
  const supabase = createAdminClient()

  const { data: row, error } = await supabase
    .from("zoho_tokens")
    .select("*")
    .eq("id", "default")
    .single()

  if (error || !row) return null

  // If token is still valid (with 5-min buffer), return it
  const expiresAt = new Date(row.expires_at).getTime()
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return row.access_token
  }

  // Token expired — refresh it
  try {
    const refreshed = await refreshAccessToken(row.refresh_token)
    const newExpiresAt = new Date(Date.now() + refreshed.expires_in * 1000).toISOString()

    await supabase
      .from("zoho_tokens")
      .update({
        access_token: refreshed.access_token,
        expires_at: newExpiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", "default")

    return refreshed.access_token
  } catch (err) {
    console.error("[zoho] Failed to refresh access token:", err)
    return null
  }
}

/**
 * Make an authenticated Zoho Campaigns API call.
 * Automatically fetches/refreshes the access token.
 */
export async function zohoApi(
  endpoint: string,
  options: RequestInit = {},
): Promise<any> {
  const token = await getAccessToken()
  if (!token) throw new Error("Zoho not connected — no valid token")

  const url = endpoint.startsWith("http") ? endpoint : `${ZOHO_API_BASE}${endpoint}`

  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      ...options.headers,
    },
  })

  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}
