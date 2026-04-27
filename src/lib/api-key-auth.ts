import { NextRequest } from "next/server"
import { randomBytes, createHash } from "crypto"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"

const KEY_PREFIX = "amasi_live_"
const RAW_ENTROPY_BYTES = 24 // → 48 hex chars; full key is prefix + 48

export interface ApiKeyRecord {
  id: string
  name: string
  status: "active" | "revoked"
}

/** Generate a new API key. Returns the raw key (to show the user ONCE) and the hash + prefix to store. */
export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const entropy = randomBytes(RAW_ENTROPY_BYTES).toString("hex")
  const rawKey = `${KEY_PREFIX}${entropy}`
  const keyHash = createHash("sha256").update(rawKey).digest("hex")
  const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + 6)
  return { rawKey, keyHash, keyPrefix }
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex")
}

function requestContext(request: NextRequest) {
  return {
    path: request.nextUrl.pathname,
    method: request.method,
    ip:
      request.headers.get("x-forwarded-for") ??
      request.headers.get("x-real-ip") ??
      "unknown",
    user_agent: request.headers.get("user-agent") ?? "unknown",
  }
}

function logAuthFailure(
  reason:
    | "missing_header"
    | "malformed_header"
    | "wrong_key_prefix"
    | "unknown_key"
    | "revoked_key",
  request: NextRequest,
  extra: Record<string, unknown> = {}
) {
  Sentry.captureMessage(`API auth failed: ${reason}`, {
    level: "warning",
    tags: { component: "api-key-auth", reason },
    extra: { ...requestContext(request), ...extra },
  })
}

/**
 * Verify the Authorization header of a request against the api_keys table.
 * Returns the key record if valid and active, otherwise null.
 * Also updates last_used_at (fire-and-forget).
 *
 * All failure modes emit a Sentry warning (or exception for DB errors) tagged
 * `component=api-key-auth` for security monitoring. See BACKLOG.md / CONTEXT.md.
 */
export async function verifyApiKey(request: NextRequest): Promise<ApiKeyRecord | null> {
  const header = request.headers.get("authorization") || request.headers.get("Authorization")
  if (!header) {
    logAuthFailure("missing_header", request)
    return null
  }

  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    logAuthFailure("malformed_header", request)
    return null
  }

  const rawKey = match[1].trim()
  if (!rawKey.startsWith(KEY_PREFIX)) {
    logAuthFailure("wrong_key_prefix", request)
    return null
  }

  const keyHash = hashApiKey(rawKey)
  // First 16 chars only — never log the full raw key.
  const keyPrefix = rawKey.slice(0, KEY_PREFIX.length + 6)
  const supabase = createAdminClient()

  // No status filter here — split detection so revoked keys produce a
  // distinct Sentry event from unknown keys.
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, status")
    .eq("key_hash", keyHash)
    .limit(1)
    .maybeSingle()

  if (error) {
    Sentry.captureException(error, {
      tags: { component: "api-key-auth", reason: "db_error" },
      extra: { ...requestContext(request), key_prefix: keyPrefix },
    })
    return null
  }

  if (!data) {
    logAuthFailure("unknown_key", request, { key_prefix: keyPrefix })
    return null
  }

  if (data.status !== "active") {
    logAuthFailure("revoked_key", request, {
      key_prefix: keyPrefix,
      key_id: data.id,
      key_name: data.name,
    })
    return null
  }

  // Touch last_used_at asynchronously; don't block the request on it.
  void supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {})

  return data as ApiKeyRecord
}
