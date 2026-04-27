/**
 * Supabase database type definitions — partial, hand-authored for schema
 * changes introduced in sql/025_reference_number_propagation.sql.
 *
 * HOW TO REGENERATE (requires SUPABASE_ACCESS_TOKEN):
 *   npx supabase gen types typescript \
 *     --project-id jmdwxymbgxwdsmcwbahp \
 *     --schema public \
 *     > src/types/database.types.ts
 *
 * Until the full schema is generated and the SupabaseClient is typed with
 * Database (see AUDIT-2026-04.md §2.4 / Pattern 4), this file documents the
 * columns added in this PR so future migrations have a reference point.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ---------------------------------------------------------------------------
// draft_applications — updated in 025_reference_number_propagation.sql
// ---------------------------------------------------------------------------

export type DraftApplicationStatus =
  | "in_progress"
  | "stuck"
  | "payment_on_hold"
  | "resumed"
  | "refund_initiated"
  | "refunded"
  | "completed"
  | "expired"

export interface DraftApplicationRow {
  id: string
  email: string
  phone: string | null
  membership_type: string | null
  current_step: number | null
  step_data: Json | null
  failure_reason: string | null
  failure_step: number | null
  status: DraftApplicationStatus | null
  payment_order_id: string | null
  payment_id: string | null
  has_verified_payment: boolean | null
  reminder_sent_at: string | null
  stale_since: string | null
  expires_at: string | null
  created_at: string | null
  updated_at: string | null
  /** Added: sql/025_reference_number_propagation.sql — nullable until OTP verify assigns it */
  reference_number: string | null
}

export type DraftApplicationInsert = Omit<DraftApplicationRow, "id" | "created_at" | "updated_at"> & {
  id?: string
  created_at?: string
  updated_at?: string
}

export type DraftApplicationUpdate = Partial<DraftApplicationInsert>

// ---------------------------------------------------------------------------
// membership_payments — updated in 025_reference_number_propagation.sql
// ---------------------------------------------------------------------------

export interface MembershipPaymentRow {
  id: string
  application_id: string | null
  member_email: string | null
  gateway_order_id: string | null
  gateway_payment_id: string | null
  gateway_signature: string | null
  payment_gateway: string | null
  status: string | null
  amount: number | null
  currency: string | null
  fee_breakdown: Json | null
  created_at: string | null
  updated_at: string | null
  /** Added: sql/025_reference_number_propagation.sql — backfilled from membership_applications via application_id */
  reference_number: string | null
}

export type MembershipPaymentInsert = Omit<MembershipPaymentRow, "id" | "created_at" | "updated_at"> & {
  id?: string
  created_at?: string
  updated_at?: string
}

export type MembershipPaymentUpdate = Partial<MembershipPaymentInsert>
