import { NextRequest } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { scoreApplication, toScorerFormShape } from "@/lib/ai-approval"

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const status = request.nextUrl.searchParams.get("status") || "all"
  const limit = parseInt(request.nextUrl.searchParams.get("limit") || "50")
  const offset = parseInt(request.nextUrl.searchParams.get("offset") || "0")

  try {
    const supabase = createAdminClient()

    let query = supabase
      .from("membership_applications")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (status === "pending") {
      query = query.in("status", ["submitted", "pending_review"])
    } else if (status === "ai_approved") {
      query = query.eq("status", "ai_approved")
    } else if (status === "approved") {
      query = query.eq("status", "approved")
    } else if (status === "rejected") {
      query = query.eq("status", "rejected")
    } else if (status === "clarification") {
      query = query.in("status", ["need_clarification", "resubmit_requested", "documents_unreadable"])
    }

    const { data, error, count } = await query

    if (error) {
      console.error("List applications error:", error)
      return Response.json({ status: false, message: "Failed to fetch applications" }, { status: 500 })
    }

    const healed = await autoHealBuggyScores(supabase, data || [])

    return Response.json({ status: true, data: healed, total: count || 0 })
  } catch (error: any) {
    return Response.json({ status: false, message: error.message }, { status: 500 })
  }
}

/**
 * Silently re-score applications whose ai_flags bear the signature of the
 * snake_case/camelCase scoring bug (resubmit path passed a raw DB row to
 * scoreApplication, which reads camelCase form keys — every lookup returned
 * undefined and produced a ~5% score with bogus "empty field" flags).
 *
 * Runs inline during the pending-list fetch so admins never see stale scores
 * after the fix ships. Idempotent — after rescoring the signature no longer
 * matches, so subsequent loads do nothing. One row = one rescore; bounded by
 * list page size.
 */
async function autoHealBuggyScores(supabase: SupabaseClient, rows: any[]): Promise<any[]> {
  const affected = rows.filter(isLikelyAffectedByBug)
  if (affected.length === 0) return rows

  const byId = new Map(rows.map((r) => [r.id, r]))

  await Promise.all(
    affected.map(async (app) => {
      try {
        const approval = await scoreApplication(
          toScorerFormShape(app),
          app.documents || {},
          app.payment_status === "paid",
          supabase,
        )
        const aiConfidence = approval.decision === "documents_unreadable"
          ? "documents_unreadable"
          : `${approval.totalScore}% — ${approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"}`
        const newFlags = [
          ...approval.flags,
          ...approval.checks.map((c) => `${c.check}: ${c.score}% ${c.passed ? "✓" : "✗"} — ${c.detail}`),
        ]

        await supabase
          .from("membership_applications")
          .update({
            ai_confidence: aiConfidence,
            ai_verified: approval.autoApprove,
            needs_manual_review: !approval.autoApprove,
            ai_flags: newFlags,
            nmc_verification: approval.nmcVerification,
          })
          .eq("id", app.id)

        const patched = {
          ...app,
          ai_confidence: aiConfidence,
          ai_verified: approval.autoApprove,
          needs_manual_review: !approval.autoApprove,
          ai_flags: newFlags,
          nmc_verification: approval.nmcVerification,
        }
        byId.set(app.id, patched)
      } catch (err) {
        console.error(`[auto-heal] rescore failed for ${app.reference_number}:`, err)
      }
    }),
  )

  return rows.map((r) => byId.get(r.id) ?? r)
}

function isLikelyAffectedByBug(app: any): boolean {
  const flags: string[] = Array.isArray(app.ai_flags) ? app.ai_flags : []
  const flagsJoined = flags.join(" | ")

  const hasEmptyFormNameFlag = /Form: ""/.test(flagsJoined) || /vs ""/.test(flagsJoined)
  const claimsNoMci = /No MCI\/Council number provided/i.test(flagsJoined) && !!app.mci_council_number
  const claimsNoPgDegree = /No PG degree specified/i.test(flagsJoined) && !!app.pg_degree
  const claimsNoOcrCollege = /no OCR\)/i.test(flagsJoined) && !!app.pg_college

  return hasEmptyFormNameFlag || claimsNoMci || claimsNoPgDegree || claimsNoOcrCollege
}
