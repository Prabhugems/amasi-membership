import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { scoreApplication, toScorerFormShape } from "@/lib/ai-approval"

/**
 * Admin endpoint: re-run AI scoring on applications with the correct
 * DB-row → form-shape mapping.
 *
 * Modes:
 *   { applicationId }           → rescore one
 *   { referenceNumber }         → rescore one (by AMASI reference)
 *   { mode: "repair-broken" }   → rescore every application whose last
 *                                 scoring hit the snake_case/camelCase
 *                                 bug. Heuristic: status still in
 *                                 submitted/need_clarification, and
 *                                 ai_flags shows the "Form: ''" signature
 *                                 or score < 10% despite having data.
 */
export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const { applicationId, referenceNumber, mode } = body as {
    applicationId?: string
    referenceNumber?: string
    mode?: "repair-broken"
  }

  const supabase = createAdminClient()

  let rows: any[] = []
  if (applicationId) {
    const { data } = await supabase.from("membership_applications").select("*").eq("id", applicationId).limit(1)
    rows = data || []
  } else if (referenceNumber) {
    const { data } = await supabase.from("membership_applications").select("*").eq("reference_number", referenceNumber).limit(1)
    rows = data || []
  } else if (mode === "repair-broken") {
    // Only consider applications that are still in a state where the AI score matters.
    const { data } = await supabase
      .from("membership_applications")
      .select("*")
      .in("status", ["submitted", "need_clarification", "resubmit_requested"])
    rows = (data || []).filter(isLikelyAffectedByBug)
  } else {
    return Response.json({ status: false, message: "Provide applicationId, referenceNumber, or mode: 'repair-broken'" }, { status: 400 })
  }

  if (rows.length === 0) {
    return Response.json({ status: true, rescored: 0, message: "No applications matched" })
  }

  const results: Array<{ id: string; reference: string; before: string | null; after: string; autoApprove: boolean }> = []
  for (const app of rows) {
    const formShape = toScorerFormShape(app)
    const approval = await scoreApplication(formShape, app.documents || {}, app.payment_status === "paid", supabase)
    const aiConfidence = `${approval.totalScore}% — ${approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"}`
    await supabase.from("membership_applications").update({
      ai_confidence: aiConfidence,
      ai_verified: approval.autoApprove,
      needs_manual_review: !approval.autoApprove,
      ai_flags: [...approval.flags, ...approval.checks.map(c => `${c.check}: ${c.score}% ${c.passed ? "✓" : "✗"} — ${c.detail}`)],
      nmc_verification: approval.nmcVerification,
    }).eq("id", app.id)
    results.push({
      id: app.id,
      reference: app.reference_number,
      before: app.ai_confidence ?? null,
      after: aiConfidence,
      autoApprove: approval.autoApprove,
    })
  }

  await logAdminAction({
    adminEmail: (session?.email as string) || "unknown",
    adminName: (session?.name as string) || undefined,
    action: "applications.rescore",
    entityType: "membership_application",
    entityId: rows.length === 1 ? rows[0].id : "batch",
    details: { count: results.length, mode: mode || "single", results },
  })

  return Response.json({ status: true, rescored: results.length, results })
}

/**
 * Heuristic for detecting applications whose ai_flags were written by the
 * snake_case/camelCase mismatch in the old resubmit path. Signature: the
 * scorer saw an empty form name while a doc-extracted name existed, OR
 * reported "No MCI/Council number" / "No PG degree specified" while the
 * DB row clearly has the data.
 */
function isLikelyAffectedByBug(app: any): boolean {
  const flags: string[] = Array.isArray(app.ai_flags) ? app.ai_flags : []
  const flagsJoined = flags.join(" | ")

  const hasEmptyFormNameFlag = /Form: ""/.test(flagsJoined) || /vs ""/.test(flagsJoined)
  const claimsNoMci = /No MCI\/Council number provided/i.test(flagsJoined) && !!app.mci_council_number
  const claimsNoPgDegree = /No PG degree specified/i.test(flagsJoined) && !!app.pg_degree
  const claimsNoOcrCollege = /no OCR\)/i.test(flagsJoined) && !!app.pg_college

  return hasEmptyFormNameFlag || claimsNoMci || claimsNoPgDegree || claimsNoOcrCollege
}
