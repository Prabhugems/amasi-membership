// src/lib/mou/type-specific-validation.ts
import type { MouEventTypeConfig, TypeSpecificFieldDef } from "./event-type-config"

type Body = Record<string, unknown>

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === ""
}

function validateField(field: TypeSpecificFieldDef, body: Body): string | null {
  switch (field.kind) {
    case "text":
    case "textarea":
    case "number": {
      const value = body[field.key]
      if (field.required && isBlank(value)) return `${field.label} is required`
      if (typeof value === "string" && field.kind === "textarea" && field.maxLength && value.length > field.maxLength) {
        return `${field.label} must be ${field.maxLength} characters or fewer`
      }
      if (field.kind === "number" && !isBlank(value)) {
        const n = Number(value)
        if (Number.isNaN(n)) return `${field.label} must be a number`
        if (field.min !== undefined && n < field.min) return `${field.label} must be at least ${field.min}`
        if (field.max !== undefined && n > field.max) return `${field.label} must be at most ${field.max}`
      }
      return null
    }
    case "radio": {
      const value = body[field.key]
      if (field.required && isBlank(value)) return `${field.label} is required`
      if (field.blockValue && value === field.blockValue.value) return field.blockValue.message
      return null
    }
    case "checkbox":
      return null
    case "faculty-rows": {
      const rows = Array.isArray(body.faculty) ? (body.faculty as Array<{ is_amasi_member?: boolean; speciality?: string | null }>) : []
      if (rows.length < field.minRows) return `At least ${field.minRows} faculty member${field.minRows === 1 ? "" : "s"} required`
      if (rows.length > field.maxRows) return `At most ${field.maxRows} faculty members allowed`
      for (const row of rows) {
        if (row.is_amasi_member === false && isBlank(row.speciality)) {
          return "Non-AMASI faculty members must have a speciality — non-member faculty are permitted only for other specialities (anaesthesia, gynaecology, urology, gastroenterology, etc.) and require prior intimation to AMASI"
        }
      }
      return null
    }
    case "association-rows": {
      const rows = Array.isArray(body.partner_associations) ? body.partner_associations : []
      if (rows.length > field.maxRows) return `At most ${field.maxRows} partner associations allowed`
      if (body.joint_programme === true && rows.length < 1) return "At least one partner association is required for a joint programme"
      return null
    }
    case "conditional-upload": {
      const conditionMet = body[field.requiredWhen.field] === field.requiredWhen.equals
      if (conditionMet && isBlank(body[`${field.docType}_url`])) return `${field.label} is required`
      return null
    }
    case "facilities-group":
      return null
  }
}

export function validateTypeSpecificFields(config: MouEventTypeConfig, body: Body): string | null {
  // Both rural_program and workshop require AMASI membership number (rural
  // spec §1: "Make required"; workshop spec §1 reuses this as-is) — every
  // OTHER type with "amasi_membership_number" in its common `fields` list
  // (fmas/mmas/dmas/slcp) leaves it optional, so this can't be a change to
  // the shared route.ts REQUIRED_FIELDS constant. Every MouEventTypeConfig
  // consumer currently has this field in `fields`, but check defensively
  // rather than assume, since a future type could theoretically omit it.
  if (config.fields.includes("amasi_membership_number") && isBlank(body.applicant_amasi_number)) {
    return "AMASI membership number is required"
  }

  if (config.requiresVenue) {
    const venueFields: [string, string][] = [
      ["venue_type", "Venue type"], ["venue_name", "Venue name"], ["venue_address", "Address"],
      ["venue_city", "City"], ["venue_state", "State"], ["venue_zip", "Postal code"],
    ]
    for (const [key, label] of venueFields) {
      if (isBlank(body[key])) return `${label} is required`
    }
  }

  if (config.minLeadDays) {
    const minDate = new Date()
    minDate.setDate(minDate.getDate() + config.minLeadDays)
    minDate.setHours(0, 0, 0, 0)
    for (const dateKey of ["preferred_date_1", "preferred_date_2"] as const) {
      const raw = body[dateKey]
      if (typeof raw !== "string" || !raw) continue
      const d = new Date(raw)
      if (d < minDate) {
        return `AMASI requires facility details one month in advance and the signed MOU 15 days before the event. Please choose a date at least ${config.minLeadDays} days away.`
      }
    }
  }

  // Runs before the generic typeSpecificFields loop below: the
  // small_state_faculty_count field also carries a generic min:2/max:3 on
  // its own TypeSpecificFieldDef (event-type-config.ts), so an out-of-range
  // count would otherwise trip the generic number-range check first and
  // return a generic "must be at most 3" message instead of the specific
  // clause-17 explanation this dedicated check exists to give.
  if (body.small_state_exception_requested === true && config.smallStateException) {
    const { chapterFlagField, venueStateField, states } = config.smallStateException
    const chapterOk = body[chapterFlagField] === true
    const venueState = body[venueStateField]
    const stateOk = typeof venueState === "string" && states.includes(venueState)
    const countRaw = body.small_state_faculty_count
    const count = typeof countRaw === "number" ? countRaw : Number(countRaw)
    const countOk = count === 2 || count === 3
    if (!chapterOk || !stateOk || !countOk) {
      return "Requesting AMASI-funded faculty transport under clause 17 requires the event to be organised by a state chapter, the venue to be in an eligible small state, and the faculty count to be 2 or 3."
    }
  }

  for (const field of config.typeSpecificFields) {
    const message = validateField(field, body)
    if (message) return message
  }

  const agreements = (body.agreements ?? {}) as Record<string, unknown>
  for (const a of config.agreements) {
    if (!agreements[a.clauseRef]) return `Please accept all agreements before submitting (missing: clause ${a.clauseRef})`
  }

  return null
}
