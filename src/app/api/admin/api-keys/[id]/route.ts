import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!id) return Response.json({ error: "API key id required" }, { status: 400 })

  const supabase = createAdminClient()
  const { error } = await supabase
    .from("api_keys")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "active")

  if (error) {
    console.error("Revoke api_key error:", error)
    return Response.json({ error: "Failed to revoke API key" }, { status: 500 })
  }

  return Response.json({ status: true, message: "API key revoked" })
}
