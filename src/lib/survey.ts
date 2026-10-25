/**
 * AMASI Survey Consortium: survey participants (DLC and PVH surveys, Oct 2026) send the name, hospital and city to
 * list them under in the manuscript, through a personal link /survey/[token]. The token (32 random bytes, base64url)
 * is minted offline and only its sha256 is stored in survey_participant_details; the link opens that one row.
 * Admins see every row, with or without details, at /admin/survey.
 */

import { createHash } from "node:crypto"

export const SURVEY_NAMES: Record<string, string> = {
  DLC: "AMASI Difficult Cholecystectomy Survey",
  PVH: "AMASI Primary Ventral Hernia Survey",
}

export const FIELD_LIMITS = { name: 200, hospital: 300, city: 120 } as const

export type SurveyField = keyof typeof FIELD_LIMITS

export type SurveyParticipantView = {
  email: string
  surveys: string[]
  name: string
  hospital: string
  city: string
  submitted: boolean
}

export type SurveyAdminRow = {
  email: string
  surveys: string[]
  name: string | null
  hospital: string | null
  city: string | null
  submitted_at: string | null
  emailed_at: string | null
}

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/

/** sha256 hex of a well-formed link token, or null for anything else (never queried). */
export function surveyTokenHash(raw: unknown): string | null {
  if (typeof raw !== "string" || !TOKEN_SHAPE.test(raw)) return null
  return createHash("sha256").update(raw).digest("hex")
}

/** The three fields a participant may send, trimmed, or the first problem with them. Anything else in the body is ignored. */
export function parseSurveyDetails(body: unknown): { ok: true; value: Record<SurveyField, string> } | { ok: false; error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>
  const value = {} as Record<SurveyField, string>
  for (const field of Object.keys(FIELD_LIMITS) as SurveyField[]) {
    const raw = typeof b[field] === "string" ? (b[field] as string).replace(/\s+/g, " ").trim() : ""
    if (!raw) return { ok: false, error: `Please fill in ${field === "hospital" ? "your hospital" : `your ${field}`}.` }
    if (raw.length > FIELD_LIMITS[field]) return { ok: false, error: `That ${field} is too long.` }
    value[field] = raw
  }
  return { ok: true, value }
}

/** "With details" means all three manuscript fields are filled, whether from our records or from the participant. */
export function hasAllDetails(row: Pick<SurveyAdminRow, "name" | "hospital" | "city">): boolean {
  return !!(row.name?.trim() && row.hospital?.trim() && row.city?.trim())
}

/**
 * One CSV cell, always quoted. Participant-typed text starting with = + - @ would run as a formula in Excel, so it
 * gets a leading quote; so does each ;-separated part, since Excel in some locales splits cells on ;.
 */
export function csvCell(value: string | null | undefined): string {
  const s = (value ?? "")
    .replace(/\r?\n/g, " ")
    .split(";")
    .map((part) => (/^\s*[=+\-@\t\r]/.test(part) ? `'${part}` : part))
    .join(";")
  return `"${s.replace(/"/g, '""')}"`
}

/** Own keys only, so ?survey=constructor or __proto__ is not a survey. */
export function isSurveyCode(code: string): boolean {
  return Object.hasOwn(SURVEY_NAMES, code)
}

export function surveyCsv(rows: SurveyAdminRow[]): string {
  const header = ["Email", "Surveys", "Name", "Hospital", "City", "Status", "Sent by participant", "Submitted at"]
  const lines = rows.map((r) =>
    [
      r.email,
      r.surveys.join(" + "),
      r.name,
      r.hospital,
      r.city,
      hasAllDetails(r) ? "with details" : "without details",
      r.submitted_at ? "yes" : "no",
      r.submitted_at ?? "",
    ]
      .map(csvCell)
      .join(",")
  )
  // BOM so Excel opens names with accents correctly.
  return "﻿" + [header.join(","), ...lines].join("\r\n") + "\r\n"
}
