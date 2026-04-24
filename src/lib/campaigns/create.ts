import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"
import { getTemplate } from "./registry"
import { MEMBER_SEGMENT_COLUMNS, type MemberSegmentRow } from "./types"

export interface CreateCampaignResult {
  campaignId: string
  totalRecipients: number
}

export async function createCampaign(params: {
  templateKey: string
  createdBy: string
  supabase?: SupabaseClient
}): Promise<CreateCampaignResult> {
  const template = getTemplate(params.templateKey)
  const db = params.supabase ?? createAdminClient()

  // Insert campaign row.
  const { data: campaign, error: insErr } = await db
    .from("email_campaigns")
    .insert({
      template_key: template.key,
      name: template.name,
      category: template.category,
      target_fields: template.targetFields,
      status: "sending",
      created_by: params.createdBy,
    })
    .select("id")
    .single()
  if (insErr || !campaign) {
    throw new Error(`failed to create campaign: ${insErr?.message ?? "unknown"}`)
  }

  // Resolve segment. Wrap with marketing opt-out filter when category = 'marketing'.
  let query = db.from("members").select(MEMBER_SEGMENT_COLUMNS)
  query = template.buildSegment(query as any) as any
  if (template.category === "marketing") {
    query = (query as any).is("marketing_opt_out_at", null)
  }
  const { data: members, error: segErr } = await query
  if (segErr) {
    throw new Error(`segment query failed: ${segErr.message}`)
  }

  const rows = (members ?? []) as MemberSegmentRow[]
  if (rows.length === 0) {
    await db.from("email_campaigns")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", campaign.id)
    return { campaignId: campaign.id, totalRecipients: 0 }
  }

  // Materialise recipients. ON CONFLICT DO NOTHING via upsert ignoreDuplicates.
  const recipientRows = rows.map((m) => ({
    campaign_id: campaign.id,
    member_id: m.id,
    email: m.email,
    amasi_number: m.amasi_number,
    name: m.name,
  }))

  // Chunk to avoid giant inserts. 500 rows per chunk is safe for Supabase.
  for (let i = 0; i < recipientRows.length; i += 500) {
    const chunk = recipientRows.slice(i, i + 500)
    const { error: recErr } = await db
      .from("email_campaign_recipients")
      .upsert(chunk, { onConflict: "campaign_id,member_id", ignoreDuplicates: true })
    if (recErr) throw new Error(`recipient insert failed: ${recErr.message}`)
  }

  return { campaignId: campaign.id, totalRecipients: recipientRows.length }
}
