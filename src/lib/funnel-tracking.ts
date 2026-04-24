import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase"

export type FunnelEventType =
  | "step_entered"
  | "doc_upload"
  | "payment"
  | "submit"
  | "approved"
  | "rejected"
  | "abandoned"

/**
 * Append a row to `application_step_events`. Read-side funnel queries build
 * conversion + cycle-time metrics from this stream, so keep calls cheap and
 * never throw — a failed audit row must not break the user-facing request.
 *
 * Use `email` as the sticky identity across the flow (draft_id may not exist
 * yet at step 1; application_id only appears after submit).
 */
export async function recordStepEvent(
  params: {
    email: string
    draftId?: string | null
    applicationId?: string | null
    eventType: FunnelEventType
    step?: number | null
    status?: string | null
    metadata?: Record<string, unknown> | null
  },
  supabase?: SupabaseClient,
): Promise<void> {
  try {
    const db = supabase ?? createAdminClient()
    const { error } = await db.from("application_step_events").insert({
      email: params.email.toLowerCase().trim(),
      draft_id: params.draftId ?? null,
      application_id: params.applicationId ?? null,
      event_type: params.eventType,
      step: params.step ?? null,
      status: params.status ?? null,
      metadata: params.metadata ?? null,
    })
    if (error) {
      console.error("[funnel-tracking] insert failed:", error.message, "| event:", params.eventType, "| email:", params.email)
    }
  } catch (err) {
    console.error("[funnel-tracking] unexpected error:", err)
  }
}
