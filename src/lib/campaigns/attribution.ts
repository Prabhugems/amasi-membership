import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"

export interface CreditCandidate {
  id: string
  sent_at: string
  target_fields: string[]
}

/**
 * Pure decision: among candidate recipient rows for one member, pick the one to
 * credit with the observed update. Rules (see plan — "Attribution rule"):
 *   - sent_at must be strictly before `at`.
 *   - target_fields must overlap changedFields (first match per field wins).
 *   - Among survivors, pick the most recent sent_at.
 */
export function pickRecipientToCredit(params: {
  candidates: CreditCandidate[]
  changedFields: string[]
  at: string
}): CreditCandidate | null {
  const atMs = Date.parse(params.at)
  const eligible = params.candidates.filter((c) => {
    if (Date.parse(c.sent_at) >= atMs) return false
    return c.target_fields.some((f) => params.changedFields.includes(f))
  })
  if (eligible.length === 0) return null
  // Most recent sent_at wins; tiebreak on id ascending for determinism.
  eligible.sort((a, b) => {
    const diff = Date.parse(b.sent_at) - Date.parse(a.sent_at)
    if (diff !== 0) return diff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
  return eligible[0]
}

/**
 * Side-effectful wrapper: fetches candidates for this member, runs the decision,
 * and writes update_detected_at. Called from the members-update handler.
 */
export async function creditUpdateIfRelevant(params: {
  memberId: string
  changedFields: string[]
  at: string
  supabase?: SupabaseClient
}): Promise<string | null> {
  const db = params.supabase ?? createAdminClient()

  // Pull recipient + campaign join in two queries (Supabase doesn't do real joins via PostgREST
  // without configured foreign keys; two small queries are fine at our scale).
  const { data: recips, error: recErr } = await db
    .from("email_campaign_recipients")
    .select("id, campaign_id, sent_at, update_detected_at")
    .eq("member_id", params.memberId)
    .is("update_detected_at", null)
    .not("sent_at", "is", null)
    .lt("sent_at", params.at)
    .order("sent_at", { ascending: false })
    .limit(20)
  if (recErr || !recips || recips.length === 0) return null

  const { data: camps, error: campErr } = await db
    .from("email_campaigns")
    .select("id, target_fields")
    .in("id", recips.map((r: any) => r.campaign_id))
  if (campErr || !camps) return null

  const byId = new Map(camps.map((c: any) => [c.id, c.target_fields as string[]]))
  const candidates: CreditCandidate[] = recips.map((r: any) => ({
    id: r.id,
    sent_at: r.sent_at,
    target_fields: byId.get(r.campaign_id) ?? [],
  }))

  const pick = pickRecipientToCredit({
    candidates,
    changedFields: params.changedFields,
    at: params.at,
  })
  if (!pick) return null

  await db.from("email_campaign_recipients")
    .update({ update_detected_at: params.at })
    .eq("id", pick.id)

  return pick.id
}
