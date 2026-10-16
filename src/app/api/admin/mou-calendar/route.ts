// @auth: admin
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { isIsoDate, parseCalendarEntryInput } from "@/lib/mou/calendar"

// Admin-added endorsed events shown on the MOU calendar alongside approved
// MOU applications (see sql/058_mou_calendar_entries.sql).

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — entries overlapping that range.
// Both params are optional; with neither, every entry is returned.
export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const from = request.nextUrl.searchParams.get("from")
  const to = request.nextUrl.searchParams.get("to")
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) {
    return Response.json({ status: false, message: "from/to must be YYYY-MM-DD" }, { status: 400 })
  }

  const supabase = createAdminClient()
  let query = supabase.from("mou_calendar_entries").select("*").order("start_date", { ascending: true }).limit(500)
  // Overlap, not containment: a multi-day entry that starts before `from`
  // but ends inside the range still belongs on the calendar.
  if (to) query = query.lte("start_date", to)
  if (from) query = query.or(`end_date.gte.${from},and(end_date.is.null,start_date.gte.${from})`)

  const { data, error } = await query
  if (error) {
    console.error("[mou-calendar] list failed:", error)
    Sentry.captureException(error, { tags: { component: "mou-calendar", op: "list" } })
    return Response.json({ status: false, message: "Failed to load calendar entries" }, { status: 500 })
  }
  return Response.json({ status: true, entries: data ?? [] })
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid JSON" }, { status: 400 })
  }

  const parsed = parseCalendarEntryInput(body)
  if (!parsed.ok) return Response.json({ status: false, message: parsed.message }, { status: 400 })

  const adminEmail = (session.email as string) || "unknown"
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("mou_calendar_entries")
    .insert({ ...parsed.value, created_by: adminEmail })
    .select()
    .single()

  if (error || !data) {
    console.error("[mou-calendar] insert failed:", error)
    Sentry.captureException(error ?? new Error("mou_calendar_entries insert returned no row"), {
      tags: { component: "mou-calendar", op: "create" },
    })
    return Response.json({ status: false, message: "Failed to add event" }, { status: 500 })
  }

  await logAdminAction({
    adminEmail,
    adminName: (session.name as string) || undefined,
    action: "mou_calendar_entry_created",
    entityType: "mou_calendar_entry",
    entityId: data.id,
    entityName: data.title,
    details: { start_date: data.start_date, end_date: data.end_date, category: data.category },
  })

  return Response.json({ status: true, entry: data }, { status: 201 })
}
