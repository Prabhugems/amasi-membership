import type { AirtableFmasianRow, AirtableSkillCourseRow } from "./types"

interface AirtableAttachment {
  id: string
  url: string
  filename: string
}

interface AirtableRaw {
  id: string
  fields: Record<string, unknown>
}

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

export function parseFmasianRecord(raw: AirtableRaw): AirtableFmasianRow {
  const f = raw.fields
  const linked = f["Skill Course Details"]
  const skillCourseRecordId =
    Array.isArray(linked) && linked.length > 0 && typeof linked[0] === "string"
      ? linked[0]
      : null
  return {
    id: raw.id,
    name: typeof f["Name"] === "string" ? (f["Name"] as string) : "",
    amasiNumber: toIntOrNull(f["AMASI Number"]),
    yearOfConvocation: toIntOrNull(f["YEAR OF CONVOCATION copy"]),
    skillCourseRecordId,
  }
}

export function parseSkillCourseRecord(raw: AirtableRaw): AirtableSkillCourseRow {
  const f = raw.fields
  const raw_attachments = f["FMAS Certificate"]
  const attachments = Array.isArray(raw_attachments) ? (raw_attachments as AirtableAttachment[]) : null
  const first = attachments && attachments.length > 0 ? attachments[0] : null
  return {
    id: raw.id,
    skillCourseNumber: toIntOrNull(f["Skill course Number"]) ?? 0,
    yearOfFmas: toIntOrNull(f["Year of FMAS"]),
    presidentName:
      typeof f["President Details"] === "string"
        ? (f["President Details"] as string)
        : null,
    convocationDateAndPlace:
      typeof f["Convocation Date and Place"] === "string"
        ? (f["Convocation Date and Place"] as string)
        : null,
    fmasCertificateAttachmentUrl: first?.url ?? null,
    fmasCertificateFilename: first?.filename ?? null,
  }
}

// Convocation date strings are free-form like:
//   "5th Nov 2015-Mumbai"
//   "02nd November 2023 Raipur"
// Strategy: take the substring after the last hyphen or, if none, after the last 4-digit year.
export function extractConvocationPlace(s: string | null): string | null {
  if (s === null || s === undefined) return null
  if (s.includes("-")) {
    const after = s.slice(s.lastIndexOf("-") + 1).trim()
    if (after) return after
  }
  const m = s.match(/\b\d{4}\b\s*(.+)$/)
  if (m && m[1]) return m[1].trim()
  return s.trim()
}
