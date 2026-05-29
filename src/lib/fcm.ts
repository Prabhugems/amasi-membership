// FCM (Firebase Cloud Messaging) HTTP v1 client. Mints a service-account
// access token via `jose` (already a dep for JWT auth) and POSTs to FCM's
// `messages:send` endpoint. No `firebase-admin` SDK dependency — that
// package pulls in node-fetch and a tree of native bindings we don't need.
//
// Configuration via env var:
//   FCM_SERVICE_ACCOUNT_KEY — the entire Firebase service-account JSON
//     (one-line, escaped). Get it from
//     Firebase Console → Project Settings → Service accounts →
//     Generate new private key (project: amasi-8a5cc).
//
// If the env var is missing/unparseable, every send call resolves to a
// graceful no-op result rather than throwing — lets the upstream caller
// (e.g. admin notifications send route) succeed at writing to
// `member_notifications` even when push delivery isn't yet configured.

import { SignJWT, importPKCS8 } from "jose"

interface ServiceAccount {
  client_email: string
  private_key: string
  project_id: string
}

interface FcmMessagePayload {
  title: string
  body: string
  imageUrl?: string | null
  actionUrl?: string | null
  data?: Record<string, string>
}

export interface FcmSendResult {
  attempted: number
  sent: number
  failed: number
  errors: { token: string; reason: string }[]
  /** True when FCM isn't configured at all — caller can skip retry logic. */
  skipped?: boolean
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null

function parseServiceAccount(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_KEY?.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ServiceAccount
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) {
      return null
    }
    // Newlines in the private_key get escaped to `\n` literals when the
    // JSON is set as a one-line env var; restore them.
    parsed.private_key = parsed.private_key.replace(/\\n/g, "\n")
    return parsed
  } catch {
    return null
  }
}

async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  if (cachedAccessToken && cachedAccessToken.expiresAt > now + 60) {
    return cachedAccessToken.token
  }

  const privateKey = await importPKCS8(sa.private_key, "RS256")
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setSubject(sa.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(privateKey)

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  })

  if (!res.ok) {
    throw new Error(`FCM token exchange failed: ${res.status} ${await res.text()}`)
  }

  const json = (await res.json()) as { access_token: string; expires_in: number }
  cachedAccessToken = {
    token: json.access_token,
    expiresAt: now + json.expires_in,
  }
  return json.access_token
}

export function isFcmConfigured(): boolean {
  return parseServiceAccount() !== null
}

/**
 * Send one notification payload to a list of FCM tokens. Returns per-token
 * delivery outcomes. The legacy Flutter binary's onMessage handler reads
 * `notification.title/body` for foreground display and `data` for routing,
 * so we send both representations.
 */
export async function sendFcmToTokens(
  tokens: string[],
  payload: FcmMessagePayload
): Promise<FcmSendResult> {
  const sa = parseServiceAccount()
  if (!sa) {
    return { attempted: tokens.length, sent: 0, failed: 0, errors: [], skipped: true }
  }
  if (tokens.length === 0) {
    return { attempted: 0, sent: 0, failed: 0, errors: [] }
  }

  const accessToken = await getAccessToken(sa)
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`

  const data: Record<string, string> = {
    title: payload.title,
    body: payload.body,
    ...(payload.imageUrl ? { notify_image: payload.imageUrl } : {}),
    ...(payload.actionUrl ? { url: payload.actionUrl } : {}),
    ...(payload.data ?? {}),
  }

  let sent = 0
  let failed = 0
  const errors: { token: string; reason: string }[] = []

  // FCM HTTP v1 is one-token-per-request. Fan out in parallel batches of 20
  // to keep latency bounded without overwhelming Google's per-IP rate.
  for (let i = 0; i < tokens.length; i += 20) {
    const batch = tokens.slice(i, i + 20)
    const results = await Promise.allSettled(
      batch.map(async (token) => {
        const message: Record<string, unknown> = {
          token,
          notification: {
            title: payload.title,
            body: payload.body,
            ...(payload.imageUrl ? { image: payload.imageUrl } : {}),
          },
          data,
          android: { priority: "high" },
          apns: {
            headers: { "apns-priority": "10" },
            payload: { aps: { sound: "default" } },
          },
        }
        const res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message }),
        })
        if (!res.ok) {
          const errBody = await res.text()
          throw new Error(`${res.status}: ${errBody.slice(0, 200)}`)
        }
      })
    )
    for (let j = 0; j < results.length; j++) {
      const r = results[j]
      if (r.status === "fulfilled") sent++
      else {
        failed++
        errors.push({ token: batch[j], reason: r.reason?.message ?? String(r.reason) })
      }
    }
  }

  return { attempted: tokens.length, sent, failed, errors }
}
