import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"

const VALID_STATUSES = new Set(["open", "in_review", "resolved", "dismissed"])

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid body" }, { status: 400 })
  }

  const newStatus = typeof body.status === "string" ? body.status : ""
  const resolutionNotes =
    typeof body.resolution_notes === "string" ? body.resolution_notes.trim() : null

  if (!VALID_STATUSES.has(newStatus)) {
    return Response.json({ error: "Invalid status" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const adminEmail = (session.email as string) || "unknown"
  const isTerminal = newStatus === "resolved" || newStatus === "dismissed"

  const { data, error } = await supabase
    .from("electoral_objections")
    .update({
      status: newStatus,
      resolution_notes: resolutionNotes,
      resolved_at: isTerminal ? new Date().toISOString() : null,
      resolved_by: isTerminal ? adminEmail : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single()

  if (error || !data) {
    console.error("Update electoral_objection error:", error)
    return Response.json({ error: "Failed to update objection" }, { status: 500 })
  }

  await logAdminAction({
    adminEmail,
    adminName: (session.name as string) || undefined,
    action: `electoral_objection_${newStatus}`,
    entityType: "electoral_objection",
    entityId: id,
    details: { status: newStatus, resolution_notes: resolutionNotes },
  }).catch((err) => console.error("[electoral_objection] audit log failed:", err))

  return Response.json({ status: true, data })
}
