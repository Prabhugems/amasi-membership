/**
 * AI Decision Observability Logger
 * Writes scoring events and outcome updates to the ai_decisions table.
 * All functions are fire-and-forget safe — errors are caught and logged, never thrown.
 */

import type { SupabaseClient } from "@supabase/supabase-js"
import type { ApprovalResult } from "@/lib/ai-approval"
import { requiresExtraction } from "@/lib/document-keys"

export interface AiDecisionInput {
  applicationId: string
  applicationReference: string
  membershipType: string
  formData: Record<string, any>
  uploads: Record<string, any>
  paymentPaid: boolean
}

/** Convert a check name to snake_case: "Name consistency across documents" → "name_consistency_across_documents" */
function toSnakeCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .trim()
}

/**
 * Log an AI scoring event to the ai_decisions table.
 * Returns the inserted row id, or null on failure.
 */
export async function logAiDecision(
  supabase: SupabaseClient,
  input: AiDecisionInput,
  result: ApprovalResult | null,
  durationMs: number,
  scoringError: unknown | null,
): Promise<string | null> {
  try {
    // Build check_results JSONB
    const checkResults: Record<string, any> = {}
    if (result?.checks) {
      for (const check of result.checks) {
        const key = toSnakeCase(check.check)
        const entry: Record<string, any> = {
          score: check.score,
          weight: check.weight,
          passed: check.passed,
          details: check.detail,
          flags: (result.flags || []).filter(f =>
            f.toLowerCase().includes(check.check.toLowerCase().split(" ")[0])
          ),
        }
        // For NMC check, add skipped_reason if API was unreachable
        if (key.includes("nmc") && result.nmcVerification?.status === "skipped") {
          entry.skipped_reason = "api_unreachable"
        }
        checkResults[key] = entry
      }
    }

    // Determine decision
    let decision: string
    if (scoringError) {
      decision = "manual_review"
    } else if (result?.autoApprove) {
      decision = "auto_approved"
    } else {
      decision = "manual_review"
    }

    // Use blockingReasons from the 4-check auto-approval gate
    const blockingReason = result && !result.autoApprove && result.blockingReasons.length > 0
      ? result.blockingReasons.join(", ")
      : null

    // Use granular NMC status from scoring result (set by nmc-cache.ts)
    const nmcApiStatus = result?.nmcApiStatus || null

    // Build input_snapshot
    const formName = [
      input.formData.firstName,
      input.formData.middleName,
      input.formData.lastName,
    ].filter(Boolean).join(" ")

    const extractedData: Record<string, any> = {}
    for (const [key, upload] of Object.entries(input.uploads || {})) {
      const u = upload as any
      extractedData[key] = {
        status: u?.status || "unknown",
        has_extracted: !!(u?.extracted && Object.keys(u.extracted).length > 0),
      }
    }

    const documents: any[] = []
    for (const [key, upload] of Object.entries(input.uploads || {})) {
      const u = upload as any
      let uploadPath = "unknown"
      if (!requiresExtraction(key)) {
        uploadPath = "ocr_skipped_expected"
      } else if (u?.fileUrl != null) {
        uploadPath = "ocr_route"
      } else if (u?.url && typeof u.url === "string" && u.url.includes("uploads/applications/")) {
        uploadPath = "direct_storage"
      }
      documents.push({
        type: key,
        status: u?.status || "unknown",
        upload_path: uploadPath,
      })
    }

    const inputSnapshot = {
      form_data: {
        name: formName,
        membership_type: input.membershipType,
        mci_number: input.formData.mciCouncilNumber || null,
        mci_state: input.formData.mciCouncilState || null,
        pg_degree: input.formData.eduPostgradDegree || null,
        pg_college: input.formData.eduPostgradCollege || null,
        pg_university: input.formData.eduPostgradUniversity || null,
      },
      extracted_data: extractedData,
      documents,
      payment_status: input.paymentPaid ? "paid" : "unpaid",
    }

    // Build error JSONB
    let errorJson: any = null
    if (scoringError) {
      const err = scoringError as any
      errorJson = {
        message: err?.message || String(scoringError),
        stack: err?.stack?.slice(0, 500) || null,
      }
    }

    const { data, error } = await supabase
      .from("ai_decisions")
      .insert({
        application_id: input.applicationId,
        application_reference: input.applicationReference,
        membership_type: input.membershipType,
        total_score: result?.totalScore ?? 0,
        decision,
        blocking_reason: blockingReason,
        check_results: checkResults,
        nmc_api_status: nmcApiStatus,
        nmc_api_response_time_ms: result?.nmcResponseTimeMs ?? null,
        input_snapshot: inputSnapshot,
        scoring_duration_ms: durationMs,
        error: errorJson,
      })
      .select("id")
      .single()

    if (error) {
      console.error("[ai-decision-log] insert failed:", error.message)
      return null
    }

    return data?.id || null
  } catch (err) {
    console.error("[ai-decision-log] logAiDecision error:", err)
    return null
  }
}

/**
 * Update the most recent ai_decisions row for an application with the final outcome.
 */
export async function updateAiDecisionOutcome(
  supabase: SupabaseClient,
  applicationId: string,
  outcome: { finalStatus: string; finalStatusBy: string; overrideReason?: string | null },
): Promise<void> {
  try {
    // Find the most recent row
    const { data: row, error: fetchError } = await supabase
      .from("ai_decisions")
      .select("id, decision")
      .eq("application_id", applicationId)
      .order("scored_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      console.error("[ai-decision-log] fetch latest decision failed:", fetchError.message)
      return
    }

    if (!row) {
      console.error("[ai-decision-log] no ai_decisions row found for application:", applicationId)
      return
    }

    // Auto-detect override
    let overrideReason = outcome.overrideReason ?? null
    if (!overrideReason) {
      if (row.decision === "manual_review" && outcome.finalStatus === "approved") {
        overrideReason = "admin_approved_despite_manual_review"
      } else if (row.decision === "auto_approved" && outcome.finalStatus === "rejected") {
        overrideReason = "admin_rejected_despite_auto_approve"
      }
    }

    const { error: updateError } = await supabase
      .from("ai_decisions")
      .update({
        final_status: outcome.finalStatus,
        final_status_by: outcome.finalStatusBy,
        final_status_at: new Date().toISOString(),
        override_reason: overrideReason,
      })
      .eq("id", row.id)

    if (updateError) {
      console.error("[ai-decision-log] outcome update failed:", updateError.message)
    }
  } catch (err) {
    console.error("[ai-decision-log] updateAiDecisionOutcome error:", err)
  }
}
