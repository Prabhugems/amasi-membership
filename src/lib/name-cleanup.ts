import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { logMembershipAuditEvent } from "@/lib/audit-log"

import { cleanMemberName } from "@/lib/clean-member-name"

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
