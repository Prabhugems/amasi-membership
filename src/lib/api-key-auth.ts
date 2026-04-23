import { NextRequest } from "next/server"
import { randomBytes, createHash } from "crypto"
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

/**
 * Verify the Authorization header of a request against the api_keys table.
 * Returns the key record if valid and active, otherwise null.
 * Also updates last_used_at (fire-and-forget).
 */
export async function verifyApiKey(request: NextRequest): Promise<ApiKeyRecord | null> {
  const header = request.headers.get("authorization") || request.headers.get("Authorization")
  if (!header) return null

  const match = header.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  const rawKey = match[1].trim()
  if (!rawKey.startsWith(KEY_PREFIX)) return null

  const keyHash = hashApiKey(rawKey)
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, status")
    .eq("key_hash", keyHash)
    .eq("status", "active")
    .limit(1)
    .maybeSingle()

  if (error || !data) return null

  // Touch last_used_at asynchronously; don't block the request on it.
  void supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {})

  return data as ApiKeyRecord
}
