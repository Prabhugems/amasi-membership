// @auth: public but token-gated (query ?token=) — non-blocking remark
// from a notified party. Never gates or changes application status.
import { NextRequest } from "next/server"
import { verifyApprovalToken } from "@/lib/mou/approval-token"
import { createRemark } from "@/lib/mou/supabase-helpers"

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = request.nextUrl.searchParams.get("token")
  const { body: remarkBody } = await request.json()
  if (!token || !remarkBody || typeof remarkBody !== "string" || !remarkBody.trim()) {
    return Response.json({ status: false, message: "token and body are required" }, { status: 400 })
  }

  // The token must be valid AND scoped to this exact application — a valid
  // token for application A must never be usable to post a remark on
  // application B just because the caller changed the [id] in the URL.
  const verified = await verifyApprovalToken(token)
  if (!verified.ok || verified.row.application_id !== id) {
    return Response.json({ status: false, message: "Invalid link for this application" }, { status: 400 })
  }

  await createRemark(id, verified.row.role, verified.row.role, remarkBody.trim())
  return Response.json({ status: true })
}
