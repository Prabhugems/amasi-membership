import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { logMembershipAuditEvent } from "@/lib/audit-log"

// Conservative repair of member name fields. Three recurring defects:
//   1. stray whitespace ("SANTHOSH  REDDY", trailing space)
//   2. the same word split across two adjacent name fields — the MCI-cert OCR
//      auto-fill / applicants retyping their first name produce
//      first="Sunil" middle="Patil" last="Patil", or middle="Santhosh"
//      last="Santhosh Reddy" (see src/lib/normalize-name.ts for the same bug
//      at write time)
//   3. ALL-CAPS tokens copied straight off the certificate
//
// Deliberately NOT touched (legitimate, and ~250 legacy rows have them):
//   - repeated single-letter initials: "Ramesh S. S.", "Kannan R R"
//   - a repeat inside ONE field: "Nyi Nyi Tun"
//   - first == last with no middle ("Kishor Kishor"): fixing would empty a
//     required field, so it is reported for manual review instead.

export interface NameFields {
  name: string | null
  first_name: string | null
  middle_name: string | null
  last_name: string | null
}

export interface NameFix {
  patch: Partial<NameFields>
  reasons: string[]
}

type FieldKey = "first_name" | "middle_name" | "last_name"
const FIELDS: FieldKey[] = ["first_name", "middle_name", "last_name"]

const collapse = (s: string) => s.replace(/\s+/g, " ").trim()
const norm = (s: string | null | undefined) => collapse(s ?? "").toLowerCase()
const lettersOnly = (t: string) => t.replace(/[^A-Za-z]/g, "")
const ROMAN = /^[IVX]+$/

/** Title-case a token only when it is fully upper-case and has 3+ letters. */
function fixCaseToken(t: string): string {
  const letters = lettersOnly(t)
  if (letters.length < 3 || ROMAN.test(letters)) return t
  if (t !== t.toUpperCase()) return t // already mixed/lower case, e.g. "McDonald"
  return t.toLowerCase().replace(/(^|[-'.])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase())
}

const fixCase = (s: string) => s.split(" ").map(fixCaseToken).join(" ")

export function cleanMemberName(row: NameFields): NameFix | null {
  const reasons = new Set<string>()
  const original = { ...row }

  // Step 1: whitespace + case, per field and on `name`.
  const fields: Record<FieldKey, string> = { first_name: "", middle_name: "", last_name: "" }
  for (const f of FIELDS) {
    const raw = row[f] ?? ""
    const cleaned = fixCase(collapse(raw))
    if (collapse(raw) !== raw && raw !== "") reasons.add("whitespace")
    if (cleaned !== collapse(raw)) reasons.add("caps")
    fields[f] = cleaned
  }
  const rawName = row.name ?? ""
  let name = fixCase(collapse(rawName))
  if (collapse(rawName) !== rawName && rawName !== "") reasons.add("whitespace")
  if (name !== collapse(rawName)) reasons.add("caps")

  // Step 2: cross-field duplicate word — only when `name` is exactly the
  // join of the three fields, so we know the fields describe the same string.
  const joined = FIELDS.map((f) => fields[f]).filter(Boolean).join(" ")
  if (norm(joined) !== "" && norm(joined) === norm(name)) {
    const tokens: { field: FieldKey; text: string }[] = []
    for (const f of FIELDS) for (const t of fields[f].split(" ").filter(Boolean)) tokens.push({ field: f, text: t })

    const drop = new Set<number>()
    for (let i = 1; i < tokens.length; i++) {
      const a = tokens[i - 1]
      const b = tokens[i]
      const ka = lettersOnly(a.text).toLowerCase()
      if (ka.length < 3 || ka !== lettersOnly(b.text).toLowerCase() || a.field === b.field) continue
      if (a.field === "middle_name") drop.add(i - 1)
      else if (b.field === "middle_name") drop.add(i)
      // first == last with nothing between: leave for manual review
    }

    if (drop.size > 0) {
      const rebuilt: Record<FieldKey, string> = { first_name: "", middle_name: "", last_name: "" }
      tokens.forEach((t, i) => {
        if (!drop.has(i)) rebuilt[t.field] = rebuilt[t.field] ? `${rebuilt[t.field]} ${t.text}` : t.text
      })
      // Never empty a required field.
      if (rebuilt.first_name && rebuilt.last_name) {
        for (const f of FIELDS) fields[f] = rebuilt[f]
        name = FIELDS.map((f) => fields[f]).filter(Boolean).join(" ")
        reasons.add("duplicate-word")
      }
    }
  }

  if (!name) return null

  const patch: Partial<NameFields> = {}
  if (name !== original.name) patch.name = name
  for (const f of FIELDS) {
    const next = fields[f] === "" ? (original[f] ? null : original[f]) : fields[f]
    if (next !== original[f]) patch[f] = next
  }
  if (Object.keys(patch).length === 0) return null
  return { patch, reasons: [...reasons] }
}

export interface NameCleanupSummary {
  dryRun: boolean
  scanned: number
  fixable: number
  applied: number
  failed: number
  capped: boolean
  byReason: Record<string, number>
  samples: { amasi_number: number; before: string | null; after: string | null; reasons: string[] }[]
}

const PAGE = 1000

export async function runNameCleanup(opts: { dryRun?: boolean; limit?: number } = {}): Promise<NameCleanupSummary> {
  const dryRun = opts.dryRun ?? false
  const limit = opts.limit ?? 300
  const supabase = createAdminClient()

  const summary: NameCleanupSummary = {
    dryRun, scanned: 0, fixable: 0, applied: 0, failed: 0, capped: false, byReason: {}, samples: [],
  }

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("members")
      .select("id, amasi_number, name, first_name, middle_name, last_name")
      .order("amasi_number", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`name-cleanup: member scan failed: ${error.message}`)
    if (!data || data.length === 0) break

    for (const row of data) {
      summary.scanned++
      const fix = cleanMemberName(row)
      if (!fix) continue
      summary.fixable++
      for (const r of fix.reasons) summary.byReason[r] = (summary.byReason[r] ?? 0) + 1
      if (summary.samples.length < 20) {
        summary.samples.push({ amasi_number: row.amasi_number, before: row.name, after: fix.patch.name ?? row.name, reasons: fix.reasons })
      }
      if (dryRun) continue
      if (summary.applied + summary.failed >= limit) { summary.capped = true; continue }

      // Optimistic guard: only write if `name` is still what we read, so a
      // concurrent admin edit is never overwritten.
      const { data: updated, error: updErr } = await supabase
        .from("members")
        .update({ ...fix.patch, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("name", row.name ?? "")
        .select("id")
      if (updErr) {
        summary.failed++
        Sentry.captureException(updErr, { tags: { job: "name-cleanup" }, extra: { amasi_number: row.amasi_number } })
        continue
      }
      if (!updated || updated.length === 0) continue // changed underneath us; next run re-evaluates

      summary.applied++
      await logMembershipAuditEvent({
        action: "name_cleanup",
        entityType: "member",
        entityId: row.id,
        oldData: { name: row.name, first_name: row.first_name, middle_name: row.middle_name, last_name: row.last_name },
        newData: { ...fix.patch, reasons: fix.reasons },
        performedBy: "cron:name-cleanup",
      }, supabase)
    }
    if (data.length < PAGE) break
  }
  return summary
}
