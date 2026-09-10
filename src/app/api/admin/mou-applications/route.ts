// GET /api/admin/mou-applications — admin list of event-hosting applications.
// Admin cookie enforced by middleware (not in PUBLIC_API_ROUTES) and again here.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { MOU_OPEN_STATUSES, isMouEventType, isMouStatus } from "@/lib/mou-events"

const LIST_SELECT =
  "id, reference_number, event_type, status, amasi_number, applicant_name, applicant_email, applicant_phone, event_title, proposed_date, proposed_end_date, proposed_year, place, state, venue_name, venue_type, joint_with_association, attachments, reviewed_by, reviewed_at, signed_mou_path, created_at, updated_at"

const MAX_LIMIT = 200

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const params = request.nextUrl.searchParams
  const supabase = createAdminClient()

  // Sidebar badge: open applications only.
  if (params.get("count") === "1") {
    const { count, error } = await supabase
      .from("mou_applications")
      .select("id", { count: "exact", head: true })
      .in("status", [...MOU_OPEN_STATUSES])
    if (error) {
      Sentry.captureException(error, { tags: { route: "api/admin/mou-applications", op: "count" } })
      return Response.json({ status: false, message: "Failed to count" }, { status: 500 })
    }
    return Response.json({ status: true, total: count ?? 0 })
  }

  const statusParam = params.get("status")
  const eventParam = params.get("event")
  const limitRaw = Number.parseInt(params.get("limit") ?? "", 10)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, MAX_LIMIT) : 100

  let q = supabase
    .from("mou_applications")
    .select(LIST_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (statusParam === "open") q = q.in("status", [...MOU_OPEN_STATUSES])
  else if (statusParam && isMouStatus(statusParam)) q = q.eq("status", statusParam)
  if (eventParam && isMouEventType(eventParam)) q = q.eq("event_type", eventParam)

  const { data, error } = await q
  if (error) {
    Sentry.captureException(error, { tags: { route: "api/admin/mou-applications", op: "list" } })
    return Response.json({ status: false, message: "Failed to load applications" }, { status: 500 })
  }

  const rows = (data ?? []).map((r) => ({
    ...r,
    attachment_count: Array.isArray(r.attachments) ? r.attachments.length : 0,
    has_signed_mou: !!r.signed_mou_path,
    attachments: undefined,
    signed_mou_path: undefined,
  }))

  return Response.json({ status: true, data: rows, total: rows.length, limit })
}
