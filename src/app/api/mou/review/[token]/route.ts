// @auth: public but token-gated — the magic link's landing summary.
import { NextRequest } from "next/server"
import { verifyApprovalToken } from "@/lib/mou/approval-token"
import { getApplicationById } from "@/lib/mou/supabase-helpers"
import { createAdminClient } from "@/lib/supabase"

export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const verified = await verifyApprovalToken(token)
  if (!verified.ok) return Response.json({ status: false, message: verified.message }, { status: 400 })

  const application = await getApplicationById(verified.row.application_id)
  if (!application) return Response.json({ status: false, message: "Application not found" }, { status: 404 })

  const supabase = createAdminClient()
  const { data: remarks } = await supabase
    .from("academic_event_remarks")
    .select("author_name, author_role, body, created_at")
    .eq("application_id", application.id)
    .order("created_at", { ascending: true })

  return Response.json({
    status: true,
    canDecide: verified.row.can_decide,
    role: verified.row.role,
    application,
    remarks: remarks ?? [],
  })
}
