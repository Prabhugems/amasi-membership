import type { TemplateEntry } from "./types"
import { profileUpdateMissingPgDegree } from "./templates/profile-update-missing-pg-degree"

const TEMPLATES: Record<string, TemplateEntry> = {
  [profileUpdateMissingPgDegree.key]: profileUpdateMissingPgDegree,
}

export function getTemplate(key: string): TemplateEntry {
  const t = TEMPLATES[key]
  if (!t) throw new Error(`unknown template: ${key}`)
  return t
}

export function listTemplates(): TemplateEntry[] {
  return Object.values(TEMPLATES)
}
