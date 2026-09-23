// @auth: admin — CSV export of MOU applications for a date range (Part B
// item 8, "Export"). Used for the annual ASI Activity Report (Dec-Nov
// year), so that's the default range when ?from=/&to= are omitted.
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { signApplicationsStorage } from "@/lib/mou/supabase-helpers"
import type { AcademicEventApplication } from "@/lib/mou/types"

function eventDateOf(app: Pick<AcademicEventApplication, "finalized_date" | "preferred_date_1">): string | null {
  return app.finalized_date || app.preferred_date_1 || null
}

// Dec 1 (previous year) – Nov 30 (current year) — the ASI Activity Report
// year currently in progress, given today's date.
function defaultAsiYearRange(now: Date): { from: string; to: string } {
  const startYear = now.getUTCMonth() === 11 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return {
    from: `${startYear}-12-01`,
    to: `${startYear + 1}-11-30`,
  }
}

function escapeCSV(value: unknown): string {
  const str = String(value ?? "")
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = request.nextUrl
  const defaults = defaultAsiYearRange(new Date())
  const from = searchParams.get("from") || defaults.from
  const to = searchParams.get("to") || defaults.to

  const supabase = createAdminClient()

  const { data: rawApplications, error } = await supabase
    .from("academic_event_applications")
    .select("*")
    .order("created_at", { ascending: true })
  if (error) {
    console.error("[mou-export] fetch failed:", error.message)
    return Response.json({ error: "Failed to fetch applications" }, { status: 500 })
  }

  const inRange = (rawApplications ?? []).filter((a) => {
    const d = eventDateOf(a)
    return d && d >= from && d <= to
  }) as AcademicEventApplication[]

  const eventIds = inRange.map((a) => a.created_event_id).filter((id): id is string => !!id)

  const [eventsRes, registrationsRes] = await Promise.all([
    eventIds.length > 0
      ? supabase.from("events").select("id, name, city, state, status").in("id", eventIds)
      : Promise.resolve({ data: [], error: null }),
    eventIds.length > 0
      ? supabase.from("registrations").select("event_id").in("event_id", eventIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (eventsRes.error) return Response.json({ error: "Failed to fetch events" }, { status: 500 })
  if (registrationsRes.error) return Response.json({ error: "Failed to fetch registrations" }, { status: 500 })

  const eventById = new Map((eventsRes.data ?? []).map((e) => [e.id, e]))
  const regCountByEventId = new Map<string, number>()
  for (const r of registrationsRes.data ?? []) {
    regCountByEventId.set(r.event_id, (regCountByEventId.get(r.event_id) ?? 0) + 1)
  }

  const signedRows = await signApplicationsStorage(inRange)

  const headers = [
    "Type", "Entity", "Event Name", "Date", "Venue", "City", "State", "Zone",
    "Organiser", "Registrations", "Report Status", "Report Documents",
  ]

  const rows = signedRows.map((a) => {
    const typeLabel = getEventTypeConfig(a.application_type_id)?.label ?? a.application_type_id
    const entity = a.event_routing === "none" ? "None (MOU only)" : a.event_routing === "college" ? "College of MAS" : a.event_routing === "amasi" ? "AMASI" : ""
    const event = a.created_event_id ? eventById.get(a.created_event_id) : null
    const regCount = a.created_event_id ? regCountByEventId.get(a.created_event_id) ?? 0 : 0
    const reportStatus = a.report_status ?? (a.report_submitted_at ? "submitted" : "not submitted")
    const docLinks = (a.report_documents ?? []).map((d) => d.fileUrl).filter(Boolean).join("; ")

    return [
      typeLabel,
      entity,
      a.event_name || event?.name || "",
      eventDateOf(a) ?? "",
      a.venue_name || "",
      a.venue_city || event?.city || "",
      a.venue_state || event?.state || "",
      a.zone || "",
      a.organizer_name,
      regCount,
      reportStatus,
      docLinks,
    ].map(escapeCSV).join(",")
  })

  const csv = [headers.map(escapeCSV).join(","), ...rows].join("\n")

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename=mou-applications-${from}-to-${to}.csv`,
    },
  })
}
