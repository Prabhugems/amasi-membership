import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { sendNextBatch } from "@/lib/campaigns/sender"
import { logAdminAction } from "@/lib/audit-log"

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

  const adminEmail = (session as { email?: string }).email || "admin"
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || undefined

  try {
    const result = await sendNextBatch({ campaignId: id, limit })
    await logAdminAction({
      adminEmail,
      action: "campaign_batch_sent",
      entityType: "campaign",
      entityId: id,
      details: { sent: result.sent, failed: result.failed, remaining: result.remaining },
      ipAddress,
    })
    return Response.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "send failed"
    await logAdminAction({
      adminEmail,
      action: "campaign_batch_failed",
      entityType: "campaign",
      entityId: id,
      details: { error: msg },
      ipAddress,
    })
    return Response.json({ error: msg }, { status: 500 })
  }
}
