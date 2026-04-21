import { createAdminClient } from "@/lib/supabase"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DraftApplication {
  id: string
  email: string
  phone: string | null
  membership_type: string | null
  current_step: number
  step_data: Record<string, unknown>
  failure_reason: string | null
  failure_step: number | null
  status: string
  payment_order_id: string | null
  payment_id: string | null
  has_verified_payment: boolean
  reminder_sent_at: string | null
  stale_since: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
}

export interface SaveDraftInput {
  email: string
  phone?: string
  membership_type?: string
  current_step: number
  step_data: Record<string, unknown>
  payment_order_id?: string
  payment_id?: string
  /** Pass the last-known `updated_at` value for optimistic locking on updates. */
  lastUpdatedAt?: string
}

export interface IncompleteCounts {
  total: number
  stuck: number
  payment_on_hold: number
  in_progress: number
  refund_initiated: number
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const STEP_LABELS: Record<number, string> = {
  1: "Select Membership Type",
  2: "Email Verification",
  3: "Document Upload",
  4: "Review Details",
  5: "Payment",
  6: "Submission",
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract Supabase Storage paths from step_data values.
 * Looks for URLs that contain `/storage/v1/object/` (the Supabase storage
 * URL pattern) and extracts the path after the bucket name.
 */
function extractStoragePaths(stepData: Record<string, unknown>): string[] {
  const paths: string[] = []
  const json = JSON.stringify(stepData)

  // Match Supabase storage URLs — signed or public — and pull out the
  // bucket-relative path.  Pattern:
  //   /storage/v1/object/(sign|public)/<bucket>/<path>
  const regex = /\/storage\/v1\/object\/(?:sign|public)\/uploads\/([^?"]+)/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(json)) !== null) {
    paths.push(decodeURIComponent(match[1]))
  }

  return Array.from(new Set(paths)) // deduplicate
}

// ---------------------------------------------------------------------------
// CRUD functions
// ---------------------------------------------------------------------------

/** Fetch a draft application by email. Returns the draft row or `null`. */
export async function getDraftByEmail(
  email: string,
): Promise<DraftApplication | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("draft_applications")
    .select("*")
    .eq("email", email)
    .maybeSingle()

  if (error) {
    console.error("[draft-utils] getDraftByEmail error:", error.message)
    return null
  }

  return data as DraftApplication | null
}

/**
 * Upsert a draft application.
 *
 * - **New draft**: inserts a row with `updated_at = now()`.
 * - **Existing draft**: updates only when `lastUpdatedAt` matches the
 *   current `updated_at` value (optimistic concurrency control). If omitted
 *   the update proceeds unconditionally.
 *
 * Returns the upserted row, or `null` on conflict / error.
 */
export async function saveDraft(
  input: SaveDraftInput,
): Promise<DraftApplication | null> {
  const supabase = createAdminClient()

  // Check if a draft already exists for this email
  const existing = await getDraftByEmail(input.email)

  if (existing) {
    // Update path — enforce optimistic lock if caller supplied lastUpdatedAt
    if (input.lastUpdatedAt && existing.updated_at !== input.lastUpdatedAt) {
      console.warn(
        "[draft-utils] saveDraft optimistic lock conflict for",
        input.email,
      )
      return null
    }

    const { data, error } = await supabase
      .from("draft_applications")
      .update({
        phone: input.phone ?? existing.phone,
        membership_type: input.membership_type ?? existing.membership_type,
        current_step: input.current_step,
        step_data: input.step_data,
        payment_order_id: input.payment_order_id ?? existing.payment_order_id,
        payment_id: input.payment_id ?? existing.payment_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single()

    if (error) {
      console.error("[draft-utils] saveDraft update error:", error.message)
      return null
    }

    return data as DraftApplication
  }

  // Insert path
  const { data, error } = await supabase
    .from("draft_applications")
    .insert({
      email: input.email,
      phone: input.phone ?? null,
      membership_type: input.membership_type ?? null,
      current_step: input.current_step,
      step_data: input.step_data,
      payment_order_id: input.payment_order_id ?? null,
      payment_id: input.payment_id ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single()

  if (error) {
    console.error("[draft-utils] saveDraft insert error:", error.message)
    return null
  }

  return data as DraftApplication
}

/**
 * Delete a draft by email. Also removes any associated files from
 * Supabase Storage (bucket: `uploads`) if `step_data` contains storage URLs.
 *
 * Returns `true` on success, `false` on error.
 */
export async function deleteDraft(email: string): Promise<boolean> {
  const supabase = createAdminClient()

  // Fetch the draft first so we can clean up storage
  const draft = await getDraftByEmail(email)
  if (!draft) return true // nothing to delete

  // Remove associated files from storage
  const paths = extractStoragePaths(draft.step_data)
  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("uploads")
      .remove(paths)

    if (storageError) {
      console.error(
        "[draft-utils] deleteDraft storage cleanup error:",
        storageError.message,
      )
      // Continue with row deletion even if storage cleanup fails
    }
  }

  const { error } = await supabase
    .from("draft_applications")
    .delete()
    .eq("email", email)

  if (error) {
    console.error("[draft-utils] deleteDraft error:", error.message)
    return false
  }

  return true
}

/** Mark a draft as stuck with a reason. */
export async function markDraftStuck(
  id: string,
  reason: string,
): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from("draft_applications")
    .update({
      status: "stuck",
      stale_since: new Date().toISOString(),
      failure_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    console.error("[draft-utils] markDraftStuck error:", error.message)
  }
}

/** Mark a draft as payment_on_hold with has_verified_payment = true. */
export async function markPaymentOnHold(id: string): Promise<void> {
  const supabase = createAdminClient()

  const { error } = await supabase
    .from("draft_applications")
    .update({
      status: "payment_on_hold",
      has_verified_payment: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)

  if (error) {
    console.error("[draft-utils] markPaymentOnHold error:", error.message)
  }
}

/**
 * List draft applications for the admin page.
 * Optionally filter by status. Ordered by `created_at` descending.
 */
export async function getIncompleteDrafts(
  filter?: { status?: string },
): Promise<DraftApplication[]> {
  const supabase = createAdminClient()

  let query = supabase
    .from("draft_applications")
    .select("*")
    .order("created_at", { ascending: false })

  if (filter?.status) {
    query = query.eq("status", filter.status)
  }

  const { data, error } = await query

  if (error) {
    console.error("[draft-utils] getIncompleteDrafts error:", error.message)
    return []
  }

  return (data ?? []) as DraftApplication[]
}

/**
 * Return aggregate counts of drafts by status.
 */
export async function getIncompleteCounts(): Promise<IncompleteCounts> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("draft_applications")
    .select("status")

  if (error) {
    console.error("[draft-utils] getIncompleteCounts error:", error.message)
    return { total: 0, stuck: 0, payment_on_hold: 0, in_progress: 0, refund_initiated: 0 }
  }

  const rows = data ?? []

  return {
    total: rows.length,
    stuck: rows.filter((r) => r.status === "stuck").length,
    payment_on_hold: rows.filter((r) => r.status === "payment_on_hold").length,
    in_progress: rows.filter((r) => r.status === "in_progress").length,
    refund_initiated: rows.filter((r) => r.status === "refund_initiated").length,
  }
}
