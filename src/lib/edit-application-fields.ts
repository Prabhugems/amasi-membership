import { STATE_TO_ZONE } from "@/lib/membership-types"

// Server-side allowlist for PATCH /api/applications/[id]/edit-fields.
// Any key not here is rejected with 400 — locked fields include payment
// columns, lifecycle/status columns, identity (email/phone), documents,
// AI artifacts, and membership_type (reserved for the tier-change route).
//
// Note on email/phone: locked because they are the OTP/login identity for
// resume + member-portal access. Changing them silently could leave an
// applicant unable to log back in or finish their application. NOT locked
// because of audit invisibility — logAdminAction() does not run the email
// scrubber.
export const EDITABLE_APPLICATION_FIELDS = new Set<string>([
  // Names
  "salutation",
  "first_name",
  "middle_name",
  "last_name",
  "father_name",
  // Demographics
  "date_of_birth",
  "gender",
  "nationality",
  // Home address
  "street_address_1",
  "street_address_2",
  "city",
  "state",
  "postal_code",
  "country",
  // Clinic address (not copied onto members row at approve — application-only)
  "clinic_name",
  "clinic_street_address_1",
  "clinic_street_address_2",
  "clinic_city",
  "clinic_state",
  "clinic_postal_code",
  "clinic_country",
  "landline",
  "std_code",
  // Education — undergraduate
  "ug_degree",
  "ug_college",
  "ug_university",
  "ug_year",
  // Education — postgraduate
  "pg_degree",
  "pg_college",
  "pg_university",
  "pg_year",
  // Education — super specialty
  "ss_degree",
  "ss_college",
  "ss_university",
  "ss_year",
  // Medical registration
  "mci_council_number",
  "mci_council_state",
  "imr_registration_no",
  "asi_membership_no",
  "asi_state",
])

export type EditableApplicationField = string

export interface PartitionResult {
  accepted: Record<string, unknown>
  rejected: string[]
}

export function partitionEditableUpdates(updates: Record<string, unknown>): PartitionResult {
  const accepted: Record<string, unknown> = {}
  const rejected: string[] = []
  for (const [key, value] of Object.entries(updates)) {
    if (EDITABLE_APPLICATION_FIELDS.has(key)) {
      accepted[key] = value
    } else {
      rejected.push(key)
    }
  }
  return { accepted, rejected }
}

function normalizeForCompare(value: unknown): string | number | null {
  if (value === null || value === undefined) return null
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed === "" ? null : trimmed
  }
  if (typeof value === "number") return value
  return String(value)
}

function valuesEqual(a: unknown, b: unknown): boolean {
  const na = normalizeForCompare(a)
  const nb = normalizeForCompare(b)
  if (na === null && nb === null) return true
  // Coerce number/string pairs for year fields ("2010" === 2010 by intent).
  if (typeof na === "number" || typeof nb === "number") {
    return String(na) === String(nb)
  }
  return na === nb
}

export interface FieldChange {
  from: unknown
  to: unknown
}

export interface FieldDiff {
  changes: Record<string, FieldChange>
  fieldCount: number
}

export function computeFieldDiff(
  currentRow: Record<string, unknown>,
  accepted: Record<string, unknown>,
): FieldDiff {
  const changes: Record<string, FieldChange> = {}
  for (const [key, value] of Object.entries(accepted)) {
    if (!valuesEqual(currentRow[key], value)) {
      changes[key] = {
        from: currentRow[key] ?? null,
        to: normalizeForCompare(value),
      }
    }
  }
  return { changes, fieldCount: Object.keys(changes).length }
}

// When `state` is part of the diff, recompute `zone` via STATE_TO_ZONE so the
// derived value stays in sync. `zone` is intentionally NOT in
// EDITABLE_APPLICATION_FIELDS — admins cannot set it directly; it always
// follows the home-state value, mirroring the apply-form derivation.
export function deriveZoneFromStateChange(
  currentRow: Record<string, unknown>,
  diff: FieldDiff,
): { zone: string | null } | Record<string, never> {
  if (!Object.prototype.hasOwnProperty.call(diff.changes, "state")) return {}
  const nextState = diff.changes.state.to
  const zone =
    typeof nextState === "string" && nextState.length > 0
      ? (STATE_TO_ZONE[nextState] ?? null)
      : null
  if (zone === (currentRow.zone ?? null)) return {}
  return { zone }
}

// Status values on `membership_applications` that block edits. Approved and
// rejected rows are finalized; edits must go through a different path
// (member-record update for approved; nothing for rejected).
export const FINAL_APPLICATION_STATUSES = new Set<string>(["approved", "rejected"])
