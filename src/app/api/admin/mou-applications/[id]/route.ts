// @auth: admin
import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { createAdminClient } from "@/lib/supabase"
import { isMouEventTypeConfig, getEventTypeConfig } from "@/lib/mou/event-type-config"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })

  const supabase = createAdminClient()
  const { data: remarks } = await supabase
    .from("academic_event_remarks")
    .select("*")
    .eq("application_id", id)
    .order("created_at", { ascending: true })

  const typeConfig = getEventTypeConfig(application.application_type_id)
  let hasSignature: boolean | null = null
  if (typeConfig && isMouEventTypeConfig(typeConfig)) {
    // Not scoped to typeConfig.mouVersion — see decide/route.ts for why: an
    // application signed under an older clause version must still be found
    // after the config's mouVersion is bumped. Order by mou_version desc
    // and take the most recent row.
    const { data: signature, error } = await supabase
      .from("mou_signatures")
      .select("id")
      .eq("application_id", id)
      .order("mou_version", { ascending: false })
      .limit(1)
      .maybeSingle()
    // A genuinely failed query (e.g. the table doesn't exist pre-migration)
    // is indistinguishable from "no signature exists" unless we check
    // `error` — both would otherwise report hasSignature: false and trip
    // the admin UI's anomaly banner. Leave hasSignature as null (unknown)
    // rather than asserting an anomaly when the query itself failed.
    hasSignature = error ? null : !!signature
  }

  return Response.json({ status: true, application, remarks: remarks ?? [], hasSignature })
}
