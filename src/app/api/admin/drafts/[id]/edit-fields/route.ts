// Admin "Edit Draft Fields" — Phase 4a of admin recovery tooling.
// Allows super_admin to fix typos / wrong values on a draft's identity,
// contact, or registration fields. Server-side allowlist enforces the
// 9-field scope; everything else (email, membership_type, uploads,
// payment) stays read-only and must flow through the normal apply path
// or the dedicated recovery surfaces.
//
// Why these specific 9 fields:
//   - High typo-rate, identity-defining, applicant-supplied (not OCR-derived)
//   - Don't break payment / submission downstream
//   - Don't trigger duplicate-check re-evaluation that would block the
//     applicant (mciCouncilNumber + mciCouncilState are in the allowlist
//     because the duplicate-check is now state-aware per 34dd145; same
//     number in a different state is fine)
//
// Mutations write to step_data.formData ONLY. The top-level email/phone
// columns are not edited — those are the persistent join keys the rest
// of the system uses to find this applicant. If a phone number is
// genuinely wrong, that requires a separate flow (changes the duplicate-
// check signature, the reminder address, etc.).
//
// Audit shape: oldData and newData carry the per-field deltas — only
// the fields that actually changed are included. The audit-log helper
// auto-masks email-shaped values; the names/numbers in this allowlist
// are recorded in clear.

import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logMembershipAuditEvent } from "@/lib/audit-log"

// The 9-field allowlist locked in with the architect 2026-05-25.
// Keys here map 1:1 to step_data.formData keys (camelCase, as the apply
// page writes them). Server-side enforcement: any other key in the
// request body is silently dropped (no rejection — keeps the contract
// forward-compatible if the client sends extras).
const EDITABLE_FIELDS = [
  "salutation",
  "firstName",
  "middleName",
  "lastName",
  "dob",
  "mobileCode",
  "mobile",
  "mciCouncilNumber",
  "mciCouncilState",
] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]
const EDITABLE_FIELDS_SET = new Set<string>(EDITABLE_FIELDS)

// Status guard: edit only allowed on parked drafts. in_progress means an
// active applicant session; an admin edit there would race the
// applicant's own save-draft writes. completed should never appear on
// /incomplete but guard anyway.
const STATUSES_BLOCKED_FOR_EDIT = new Set(["in_progress", "completed"])

// Loose value coercion: trim strings, pass through `null`/`undefined`
// (interpreted as "clear this field"). Anything not a string is rejected
// with a 400.
function coerceValue(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw !== "string") {
    throw new Error("Field values must be strings or null")
  }
  return raw.trim()
}

// Basic shape validation per field. Light by design — admin entered the
// value, they likely know what they're doing, and the applicant's resume
// will re-validate downstream. Returns null on OK, error string on fail.
function validateField(key: EditableField, value: string | null): string | null {
  if (value === null || value === "") return null // empty / clear is allowed for middleName, dob, etc.
  switch (key) {
    case "mobile": {
      // Indian 10-digit when mobileCode is +91; otherwise allow 7-15 digits.
      if (!/^\d{7,15}$/.test(value)) {
        return "mobile must be 7–15 digits, no spaces or symbols"
      }
      return null
    }
    case "mobileCode": {
      if (!/^\+\d{1,4}$/.test(value)) {
        return "mobileCode must look like \"+91\" — a + and 1–4 digits"
      }
      return null
    }
    case "dob": {
      // ISO YYYY-MM-DD only — matches what the apply page writes.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return "dob must be ISO format YYYY-MM-DD"
      }
      const d = new Date(value)
      if (Number.isNaN(d.getTime())) {
        return "dob is not a valid date"
      }
      return null
    }
    case "firstName":
    case "lastName":
    case "middleName":
    case "salutation":
    case "mciCouncilNumber":
    case "mciCouncilState":
      // String length sanity only — the apply form already enforces
      // its own constraints when the applicant resumes.
      if (value.length > 200) return `${key} is unreasonably long (>200 chars)`
      return null
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: draftId } = await params
  if (!draftId) {
    return Response.json({ error: "draftId is required" }, { status: 400 })
  }

  // Auth — same gate as Phase 1 unexpire.
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }
  if (session.adminRole !== "super_admin") {
    return Response.json(
      { error: "This action requires super_admin." },
      { status: 403 },
    )
  }

  // Parse body. Expected shape: { fields: { [key]: string | null } }.
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const fieldsIn = (body as { fields?: Record<string, unknown> } | null)?.fields
  if (!fieldsIn || typeof fieldsIn !== "object") {
    return Response.json(
      { error: "Body must include `fields: { <key>: <value>, ... }`" },
      { status: 400 },
    )
  }

  // Coerce + validate each provided field against the allowlist.
  // Unknown keys (anything outside EDITABLE_FIELDS) are dropped silently.
  const coerced: Partial<Record<EditableField, string | null>> = {}
  for (const [k, rawV] of Object.entries(fieldsIn)) {
    if (!EDITABLE_FIELDS_SET.has(k)) continue
    const key = k as EditableField
    let value: string | null
    try {
      value = coerceValue(rawV)
    } catch (e) {
      return Response.json(
        { error: `Invalid value for ${key}: ${(e as Error).message}` },
        { status: 400 },
      )
    }
    const validationError = validateField(key, value)
    if (validationError) {
      return Response.json(
        { error: `Invalid ${key}: ${validationError}` },
        { status: 400 },
      )
    }
    coerced[key] = value
  }

  if (Object.keys(coerced).length === 0) {
    return Response.json(
      { error: "No editable fields provided" },
      { status: 400 },
    )
  }

  const supabase = createAdminClient()

  // Load draft to compute the per-field delta + verify status gate.
  const { data: draft, error: fetchError } = await supabase
    .from("draft_applications")
    .select("id, status, step_data, updated_at")
    .eq("id", draftId)
    .maybeSingle()

  if (fetchError) {
    console.error("[admin/drafts/edit-fields] fetch error:", fetchError.message)
    return Response.json({ error: "Failed to load draft" }, { status: 500 })
  }
  if (!draft) {
    return Response.json({ error: "Draft not found" }, { status: 404 })
  }
  if (STATUSES_BLOCKED_FOR_EDIT.has(draft.status as string)) {
    return Response.json(
      {
        error:
          draft.status === "in_progress"
            ? "Cannot edit a draft that's actively being filled by the applicant. Wait for it to go stuck/payment_on_hold or use Send Reminder."
            : `Cannot edit a draft with status "${draft.status}".`,
      },
      { status: 409 },
    )
  }

  // Compute the delta against the current formData. Only fields that
  // ACTUALLY changed go into the audit log + into the merged formData.
  // This keeps the audit trail noise-free when an admin opens the dialog,
  // tweaks one field, and hits Save without touching the others.
  const stepData = (draft.step_data as { formData?: Record<string, unknown> } | null) ?? {}
  const currentFormData = (stepData.formData as Record<string, unknown>) ?? {}

  const oldDelta: Record<string, unknown> = {}
  const newDelta: Record<string, unknown> = {}
  for (const [key, newValue] of Object.entries(coerced)) {
    const oldValue = currentFormData[key]
    // Treat "" / null / undefined as the same cleared state for diff purposes.
    const normalizeForCompare = (v: unknown) => (v == null || v === "" ? null : v)
    if (normalizeForCompare(oldValue) !== normalizeForCompare(newValue)) {
      oldDelta[key] = oldValue ?? null
      newDelta[key] = newValue
    }
  }

  if (Object.keys(newDelta).length === 0) {
    return Response.json({
      ok: true,
      draftId,
      updated: {},
      message: "No changes — submitted values matched the draft.",
    })
  }

  // Build the merged step_data. Preserve every other key in step_data
  // (uploads, email_verified flags, etc.); only formData gets the merge.
  const mergedFormData = { ...currentFormData, ...newDelta }
  const mergedStepData = { ...stepData, formData: mergedFormData }

  const { data: updated, error: updateError } = await supabase
    .from("draft_applications")
    .update({
      step_data: mergedStepData,
      updated_at: new Date().toISOString(),
    })
    .eq("id", draftId)
    .not("status", "in", '("in_progress","completed")')
    .select("id")
    .maybeSingle()

  if (updateError) {
    console.error("[admin/drafts/edit-fields] update error:", updateError.message)
    return Response.json({ error: "Failed to save edits" }, { status: 500 })
  }
  if (!updated) {
    return Response.json(
      { error: "Draft state changed during update; please refresh and try again." },
      { status: 409 },
    )
  }

  // Audit — per-field delta only. The helper auto-masks email-shaped
  // fields under PII scrub; names/numbers are recorded in clear.
  await logMembershipAuditEvent(
    {
      action: "draft_field_edited",
      entityType: "draft_application",
      entityId: draftId,
      oldData: oldDelta,
      newData: newDelta,
      performedBy: (session as { email?: string }).email || "admin (super_admin)",
    },
    supabase,
  )

  return Response.json({ ok: true, draftId, updated: newDelta })
}
