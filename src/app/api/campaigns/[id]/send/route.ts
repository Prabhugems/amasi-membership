import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { sendNextBatch } from "@/lib/campaigns/sender"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({}))
  const limit = typeof body?.limit === "number" && body.limit > 0 && body.limit <= 500
    ? body.limit
    : 100

  try {
    const result = await sendNextBatch({ campaignId: id, limit })
    return Response.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send failed"
    return Response.json({ error: msg }, { status: 500 })
  }
}
