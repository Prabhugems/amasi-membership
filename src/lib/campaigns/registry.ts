import type { TemplateEntry } from "./types"
import { profileUpdateMissingPgDegree } from "./templates/profile-update-missing-pg-degree"
import { egmNotice20260617 } from "./templates/egm-notice-2026-06-17"

const TEMPLATES: Record<string, TemplateEntry> = {
  [profileUpdateMissingPgDegree.key]: profileUpdateMissingPgDegree,
  [egmNotice20260617.key]: egmNotice20260617,
}

export function getTemplate(key: string): TemplateEntry {
  const t = TEMPLATES[key]
  if (!t) throw new Error(`unknown template: ${key}`)
  return t
}

export function listTemplates(): TemplateEntry[] {
  return Object.values(TEMPLATES)
}
