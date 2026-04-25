import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { listTemplates } from "@/lib/campaigns/registry"
import { createCampaign } from "@/lib/campaigns/create"
import { logAdminAction } from "@/lib/audit-log"
import type { CampaignRow } from "@/lib/campaigns/types"

interface CampaignSummary extends CampaignRow {
  total: number
  sent: number
  failed: number
  pending: number
  credited: number
}

export async function GET() {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const db = createAdminClient()

  const { data: campaigns, error } = await db
    .from("email_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(20)
    .returns<CampaignRow[]>()
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const summaries: CampaignSummary[] = []
  let totalEmailsSent = 0
  let membersCredited = 0

  // NOTE: N+1 — five count queries per campaign. Fine at LIMIT 20; replace with
  // a SQL view / RPC before we remove the limit. See out-of-scope section.
  for (const c of campaigns ?? []) {
    const [totalQ, sentQ, failedQ, pendingQ, creditedQ] = await Promise.all([
      db.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id),
      db.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("sent_at", "is", null),
      db.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("send_error", "is", null),
      db.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).is("sent_at", null),
      db.from("email_campaign_recipients").select("*", { count: "exact", head: true }).eq("campaign_id", c.id).not("update_detected_at", "is", null),
    ])
    const total = totalQ.count ?? 0
    const sent = sentQ.count ?? 0
    const failed = failedQ.count ?? 0
    const pending = pendingQ.count ?? 0
    const credited = creditedQ.count ?? 0
    summaries.push({ ...c, total, sent, failed, pending, credited })
    totalEmailsSent += sent
    membersCredited += credited
  }

  return Response.json({
    campaigns: summaries,
    stats: {
      totalCampaigns: summaries.length,
      totalEmailsSent,
      membersUpdated: membersCredited,
    },
    templates: listTemplates().map((t) => ({
      key: t.key, name: t.name, category: t.category, targetFields: t.targetFields,
    })),
  })
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const templateKey = typeof body?.templateKey === "string" ? body.templateKey : null
  if (!templateKey) return Response.json({ error: "templateKey required" }, { status: 400 })

  const adminEmail = (session as { email?: string }).email || "admin"
  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || undefined

  try {
    const result = await createCampaign({ templateKey, createdBy: adminEmail })
    await logAdminAction({
      adminEmail,
      action: "campaign_created",
      entityType: "campaign",
      entityId: result.campaignId,
      details: { templateKey, totalRecipients: result.totalRecipients },
      ipAddress,
    })
    return Response.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "create failed"
    return Response.json({ error: msg }, { status: 500 })
  }
}
