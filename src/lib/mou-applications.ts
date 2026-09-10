/**
 * Server-side validation for event-hosting (MOU) applications.
 *
 * Security posture (rafter-secure-design walk, 2026-09-10):
 * - The request body is parsed into an explicit allowlist of fields. Unknown
 *   keys are dropped; nothing is spread into the insert. Applicant identity
 *   (member_id, amasi_number, name, email, phone, address) is NEVER read from
 *   the body — the API copies it from `members` after session validation.
 * - Every string has a max length, every number a range, arrays a max size.
 * - Attachment paths must sit under `mou/<member_id>/` and match the random
 *   file-name shape written by /api/mou/upload, so a member can't reference
 *   another member's (or any other bucket) object.
 * - Event-specific answers are validated against the field list declared in
 *   src/lib/mou-events.ts, so the stored `details` shape is bounded too.
 */
import { randomBytes } from "node:crypto"
import {
  MOU_EVENTS,
  MOU_MAX_ATTACHMENTS,
  MOU_ATTACHMENT_KEYS,
  MOU_ATTACHMENT_LABELS,
  MOU_VENUE_TYPES,
  isMouEventType,
  requiredMouAttachments,
  type MouAttachmentKey,
  type MouEventType,
  type MouField,
  type MouVenueType,
} from "@/lib/mou-events"

export interface MouAttachment {
  key: MouAttachmentKey
  path: string
  filename: string
  size: number
  content_type: string
}

export interface MouSubmission {
  event_type: MouEventType
  event_title: string | null
  proposed_date: string | null
  proposed_end_date: string | null
  proposed_year: number | null
  place: string
  state: string | null
  venue_name: string | null
  venue_type: MouVenueType | null
  joint_with_association: boolean
  partner_association: string | null
  supporting_city_chapter: string | null
  supporting_state_chapter: string | null
  supporting_others: string | null
  remarks: string | null
  details: Record<string, string | number>
  declarations: Record<string, true>
  attachments: MouAttachment[]
}

export type MouValidationResult =
  | { ok: true; value: MouSubmission }
  | { ok: false; errors: Record<string, string> }

const LIMITS = {
  event_title: 200,
  place: 120,
  state: 80,
  venue_name: 200,
  partner_association: 200,
  supporting: 200,
  remarks: 3000,
  filename: 160,
} as const

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// mou/<member_id>/<uuid>.<ext> — member_id is text in prod (UUID-shaped, but
// we only require a safe charset), file name is server-generated.
const ATTACHMENT_PATH_RE =
  /^mou\/[A-Za-z0-9_-]{1,64}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(pdf|jpg|png)$/

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_RE.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : value
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function validateDetailField(
  field: MouField,
  raw: unknown,
  errors: Record<string, string>
): string | number | undefined {
  const errKey = `details.${field.key}`
  if (raw === undefined || raw === null || raw === "") {
    if (field.required) errors[errKey] = `${field.label} is required`
    return undefined
  }
  switch (field.kind) {
    case "number": {
      const n = typeof raw === "number" ? raw : Number(String(raw).trim())
      if (!Number.isFinite(n)) {
        errors[errKey] = `${field.label} must be a number`
        return undefined
      }
      const min = field.min ?? 0
      const max = field.max ?? 1_000_000
      if (n < min || n > max) {
        errors[errKey] = `${field.label} must be between ${min} and ${max}`
        return undefined
      }
      return Math.round(n)
    }
    case "select": {
      const s = typeof raw === "string" ? raw : ""
      if (!field.options?.some((o) => o.value === s)) {
        errors[errKey] = `Choose a valid option for ${field.label}`
        return undefined
      }
      return s
    }
    case "text":
    case "textarea": {
      const max = field.maxLength ?? (field.kind === "textarea" ? 3000 : 200)
      const s = str(raw, max)
      if (!s) {
        if (field.required) errors[errKey] = `${field.label} is required`
        return undefined
      }
      return s
    }
  }
}

export function validateMouSubmission(input: unknown, memberId: string): MouValidationResult {
  const errors: Record<string, string> = {}
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>

  if (!isMouEventType(body.event_type)) {
    return { ok: false, errors: { event_type: "Unknown event type" } }
  }
  const config = MOU_EVENTS[body.event_type]

  // --- schedule -----------------------------------------------------------
  let proposed_date: string | null = null
  let proposed_end_date: string | null = null
  let proposed_year: number | null = null
  const today = todayIso()
  if (config.scheduleMode === "year") {
    const y = Number(body.proposed_year)
    const thisYear = new Date().getFullYear()
    if (!Number.isInteger(y) || y < thisYear || y > thisYear + 6) {
      errors.proposed_year = `Year must be between ${thisYear} and ${thisYear + 6}`
    } else {
      proposed_year = y
    }
  } else {
    proposed_date = isoDate(body.proposed_date)
    if (!proposed_date) {
      errors.proposed_date = "Proposed date is required (YYYY-MM-DD)"
    } else if (proposed_date < today) {
      errors.proposed_date = "Proposed date must be in the future"
    }
    if (config.scheduleMode === "date-range" && body.proposed_end_date) {
      proposed_end_date = isoDate(body.proposed_end_date)
      if (!proposed_end_date) {
        errors.proposed_end_date = "End date must be a valid date (YYYY-MM-DD)"
      } else if (proposed_date && proposed_end_date < proposed_date) {
        errors.proposed_end_date = "End date cannot be before the start date"
      }
    }
  }

  // --- common fields --------------------------------------------------------
  const place = str(body.place, LIMITS.place)
  if (!place) errors.place = "Place (city) is required"
  const state = str(body.state, LIMITS.state)
  if (!state) errors.state = "State is required"
  const event_title = str(body.event_title, LIMITS.event_title)
  const venue_name = str(body.venue_name, LIMITS.venue_name)
  if (!venue_name) errors.venue_name = "Venue / institution name is required"

  const venueRaw = typeof body.venue_type === "string" ? body.venue_type : ""
  const venue_type = MOU_VENUE_TYPES.some((v) => v.value === venueRaw)
    ? (venueRaw as MouVenueType)
    : null
  if (!venue_type) errors.venue_type = "Choose where the event will be held"

  const joint_with_association = body.joint_with_association === true
  const partner_association = str(body.partner_association, LIMITS.partner_association)
  if (joint_with_association && !partner_association) {
    errors.partner_association = "Name the partner association"
  }

  const supporting_city_chapter = str(body.supporting_city_chapter, LIMITS.supporting)
  const supporting_state_chapter = str(body.supporting_state_chapter, LIMITS.supporting)
  const supporting_others = str(body.supporting_others, LIMITS.supporting)
  const remarks = str(body.remarks, LIMITS.remarks)

  // --- event-specific details ----------------------------------------------
  const detailsRaw = (body.details && typeof body.details === "object" ? body.details : {}) as Record<
    string,
    unknown
  >
  const details: Record<string, string | number> = {}
  for (const field of config.fields) {
    const v = validateDetailField(field, detailsRaw[field.key], errors)
    if (v !== undefined) details[field.key] = v
  }

  // --- declarations ---------------------------------------------------------
  const declRaw = (body.declarations && typeof body.declarations === "object" ? body.declarations : {}) as Record<
    string,
    unknown
  >
  const declarations: Record<string, true> = {}
  for (const d of config.declarations) {
    if (declRaw[d.key] !== true) {
      errors[`declarations.${d.key}`] = "You must accept this declaration"
    } else {
      declarations[d.key] = true
    }
  }

  // --- attachments ----------------------------------------------------------
  const attachments: MouAttachment[] = []
  const attRaw = Array.isArray(body.attachments) ? body.attachments : []
  if (attRaw.length > MOU_MAX_ATTACHMENTS) {
    errors.attachments = `At most ${MOU_MAX_ATTACHMENTS} attachments`
  } else {
    const seenPaths = new Set<string>()
    for (const item of attRaw) {
      const a = (item && typeof item === "object" ? item : {}) as Record<string, unknown>
      const key = typeof a.key === "string" ? a.key : ""
      if (!(MOU_ATTACHMENT_KEYS as readonly string[]).includes(key)) {
        errors.attachments = "Unknown attachment type"
        break
      }
      const path = typeof a.path === "string" ? a.path : ""
      if (!ATTACHMENT_PATH_RE.test(path) || !path.startsWith(`mou/${memberId}/`)) {
        errors.attachments = "Invalid attachment reference — please re-upload the file"
        break
      }
      if (seenPaths.has(path)) continue
      seenPaths.add(path)
      const size = typeof a.size === "number" && Number.isFinite(a.size) ? Math.max(0, Math.round(a.size)) : 0
      const content_type =
        typeof a.content_type === "string" && /^(application\/pdf|image\/(jpeg|png))$/.test(a.content_type)
          ? a.content_type
          : "application/octet-stream"
      attachments.push({
        key: key as MouAttachmentKey,
        path,
        filename: str(a.filename, LIMITS.filename) ?? path.split("/").pop() ?? "file",
        size,
        content_type,
      })
    }
  }

  if (venue_type && !errors.attachments) {
    const required = requiredMouAttachments({ venueType: venue_type, jointWithAssociation: joint_with_association })
    for (const key of required) {
      if (!attachments.some((a) => a.key === key)) {
        errors[`attachments.${key}`] = `${MOU_ATTACHMENT_LABELS[key]} is required`
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }

  return {
    ok: true,
    value: {
      event_type: config.slug,
      event_title,
      proposed_date,
      proposed_end_date,
      proposed_year,
      place: place!,
      state,
      venue_name,
      venue_type,
      joint_with_association,
      partner_association: joint_with_association ? partner_association : null,
      supporting_city_chapter,
      supporting_state_chapter,
      supporting_others,
      remarks,
      details,
      declarations,
      attachments,
    },
  }
}

/**
 * MOU-YYYY-XXXXXXXX — 4 random bytes (≈4.3 billion per year). The insert
 * retries on a unique violation, so a collision is a retry, not a failure.
 */
export function generateMouReference(): string {
  const year = new Date().getFullYear()
  return `MOU-${year}-${randomBytes(4).toString("hex").toUpperCase()}`
}

/** Sanitise a client-supplied file name for display only (never used in a path). */
export function safeDisplayFilename(name: unknown): string {
  if (typeof name !== "string") return "file"
  const cleaned = name.replace(/[\u0000-\u001f<>"'`\\]/g, "").trim()
  return (cleaned || "file").slice(0, LIMITS.filename)
}
