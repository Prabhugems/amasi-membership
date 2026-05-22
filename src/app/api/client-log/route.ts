// @auth: public — unload-safe relay for client diagnostics; handler sanitizes input, rate-limits per IP, returns 204
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { checkRateLimit } from "@/lib/rate-limit"

// Unload-safe relay for client-side diagnostic events. Public by design:
// callers POST via navigator.sendBeacon during tab close, before any user
// gesture is possible — auth here would defeat the purpose. Security model:
//
//   1. Never reads anything from the request beyond a fixed, sanitized field
//      set: message (clipped), level (enum), tags (k/v string map, capped),
//      extra (k/v primitive map, capped).
//   2. Never echoes any input back to the caller — always 204 No Content.
//   3. Rate-limited per IP (30/min) to bound Sentry quota abuse.
//   4. Injects `source: "client_log_relay"` on every event so Sentry queries
//      can distinguish relayed messages from authentic in-process SDK events.

const ALLOWED_LEVELS: ReadonlySet<Sentry.SeverityLevel> = new Set([
  "info",
  "warning",
  "error",
  "fatal",
])
const MAX_MESSAGE_LENGTH = 500
const MAX_KEY_LENGTH = 50
const MAX_TAG_KEYS = 10
const MAX_TAG_VALUE_LENGTH = 100
const MAX_EXTRA_KEYS = 20
const MAX_EXTRA_VALUE_LENGTH = 500

function clipString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null
  if (v.length === 0) return null
  return v.length > max ? v.slice(0, max) : v
}

function sanitizeTags(input: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!input || typeof input !== "object") return out
  let count = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_TAG_KEYS) break
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_KEY_LENGTH) continue
    const value = typeof v === "string" ? v : v == null ? "" : String(v)
    const clipped = clipString(value, MAX_TAG_VALUE_LENGTH)
    if (clipped === null) continue
    out[k] = clipped
    count++
  }
  return out
}

function sanitizeExtra(
  input: unknown,
): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!input || typeof input !== "object") return out
  let count = 0
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_EXTRA_KEYS) break
    if (typeof k !== "string" || k.length === 0 || k.length > MAX_KEY_LENGTH) continue
    if (v === null || typeof v === "boolean" || typeof v === "number") {
      out[k] = v
      count++
      continue
    }
    if (typeof v === "string") {
      const clipped = clipString(v, MAX_EXTRA_VALUE_LENGTH)
      if (clipped !== null) {
        out[k] = clipped
        count++
      }
      continue
    }
    // Other types: serialize defensively and clip. Skip on serialization failure.
    let serialized: string | null = null
    try {
      serialized = JSON.stringify(v)
    } catch {
      serialized = null
    }
    if (serialized) {
      const clipped = clipString(serialized, MAX_EXTRA_VALUE_LENGTH)
      if (clipped !== null) {
        out[k] = clipped
        count++
      }
    }
  }
  return out
}

export async function POST(request: NextRequest) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`client-log:${ip}`, 30, 60 * 1000)
  if (!rl.allowed) return new Response(null, { status: 204 })

  let parsed: unknown = null
  try {
    parsed = await request.json()
  } catch {
    return new Response(null, { status: 204 })
  }
  if (!parsed || typeof parsed !== "object") {
    return new Response(null, { status: 204 })
  }

  const body = parsed as Record<string, unknown>
  const message = clipString(body.message, MAX_MESSAGE_LENGTH)
  if (!message) return new Response(null, { status: 204 })

  const levelRaw = typeof body.level === "string" ? body.level : "warning"
  const level: Sentry.SeverityLevel = ALLOWED_LEVELS.has(
    levelRaw as Sentry.SeverityLevel,
  )
    ? (levelRaw as Sentry.SeverityLevel)
    : "warning"

  Sentry.captureMessage(message, {
    level,
    tags: { ...sanitizeTags(body.tags), source: "client_log_relay" },
    extra: sanitizeExtra(body.extra),
  })

  return new Response(null, { status: 204 })
}
