import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { generateApiKey } from "@/lib/api-key-auth"

export async function GET() {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, status, created_at, created_by, last_used_at, revoked_at")
    .order("created_at", { ascending: false })

  if (error) {
    console.error("List api_keys error:", error)
    return Response.json({ error: "Failed to list API keys" }, { status: 500 })
  }

  return Response.json({ status: true, data: data || [] })
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { name } = await request.json().catch(() => ({}))
  const trimmed = typeof name === "string" ? name.trim() : ""
  if (!trimmed) {
    return Response.json({ error: "Name is required" }, { status: 400 })
  }

  const { rawKey, keyHash, keyPrefix } = generateApiKey()
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("api_keys")
    .insert({
      name: trimmed,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      created_by: typeof session.email === "string" ? session.email : null,
    })
    .select("id, name, key_prefix, status, created_at, created_by")
    .single()

  if (error || !data) {
    console.error("Create api_key error:", error)
    return Response.json({ error: "Failed to create API key" }, { status: 500 })
  }

  // Raw key is returned exactly once. It cannot be retrieved later.
  return Response.json({ status: true, data: { ...data, raw_key: rawKey } })
}
