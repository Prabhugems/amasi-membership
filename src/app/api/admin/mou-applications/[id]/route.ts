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
    const { data: signature } = await supabase
      .from("mou_signatures")
      .select("id")
      .eq("application_id", id)
      .eq("mou_version", typeConfig.mouVersion)
      .maybeSingle()
    hasSignature = !!signature
  }

  return Response.json({ status: true, application, remarks: remarks ?? [], hasSignature })
}
