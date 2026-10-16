// @auth: admin
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { parseCalendarEntryInput } from "@/lib/mou/calendar"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Full replace of an endorsed calendar entry — the edit dialog always sends
// every field, and sharing parseCalendarEntryInput with POST means the two
// can't validate differently.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ status: false, message: "Invalid id" }, { status: 400 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid JSON" }, { status: 400 })
  }

  const parsed = parseCalendarEntryInput(body)
  if (!parsed.ok) return Response.json({ status: false, message: parsed.message }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("mou_calendar_entries")
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle()

  if (error) {
    console.error("[mou-calendar] update failed:", error)
    Sentry.captureException(error, { tags: { component: "mou-calendar", op: "update" }, extra: { id } })
    return Response.json({ status: false, message: "Failed to update event" }, { status: 500 })
  }
  if (!data) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  await logAdminAction({
    adminEmail: (session.email as string) || "unknown",
    adminName: (session.name as string) || undefined,
    action: "mou_calendar_entry_updated",
    entityType: "mou_calendar_entry",
    entityId: id,
    entityName: data.title,
    details: { start_date: data.start_date, end_date: data.end_date, category: data.category },
  })

  return Response.json({ status: true, entry: data })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params
  if (!UUID_RE.test(id)) return Response.json({ status: false, message: "Invalid id" }, { status: 400 })

  const supabase = createAdminClient()
  const { data, error } = await supabase.from("mou_calendar_entries").delete().eq("id", id).select().maybeSingle()

  if (error) {
    console.error("[mou-calendar] delete failed:", error)
    Sentry.captureException(error, { tags: { component: "mou-calendar", op: "delete" }, extra: { id } })
    return Response.json({ status: false, message: "Failed to delete event" }, { status: 500 })
  }
  if (!data) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  await logAdminAction({
    adminEmail: (session.email as string) || "unknown",
    adminName: (session.name as string) || undefined,
    action: "mou_calendar_entry_deleted",
    entityType: "mou_calendar_entry",
    entityId: id,
    entityName: data.title,
    details: { start_date: data.start_date, end_date: data.end_date },
  })

  return Response.json({ status: true })
}
