// @auth: public — status lookup by application id. The id (a UUID) acts
// as the capability token; there is no separate login for applicants.
import { NextRequest } from "next/server"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { createAdminClient } from "@/lib/supabase"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  const supabase = createAdminClient()
  const { data: remarks } = await supabase
    .from("academic_event_remarks")
    .select("author_name, author_role, body, created_at")
    .eq("application_id", id)
    .order("created_at", { ascending: true })

  return Response.json({
    status: true,
    application: {
      id: application.id,
      application_type_id: application.application_type_id,
      status: application.status,
      organizer_name: application.organizer_name,
      event_name: application.event_name,
      created_at: application.created_at,
      reviewed_at: application.reviewed_at,
      rejection_reason: application.rejection_reason,
    },
    remarks: remarks ?? [],
  })
}
