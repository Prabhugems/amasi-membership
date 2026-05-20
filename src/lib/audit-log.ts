import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"

// Mask an email so identification is preserved (first 3 chars + domain)
// but the full address is not retrievable. "naveen@gmail.com" → "nav***@gmail.com".
function maskEmail(value: string): string {
  const at = value.indexOf("@")
  if (at < 1) return "***"
  const local = value.slice(0, at)
  const domain = value.slice(at)
  return `${local.slice(0, Math.min(3, local.length))}***${domain}`
}

// Recursively scrub PII (currently: email-shaped strings under any key
// named "email" or under "applicant_email"/"member_email") from a
// payload before it's persisted to membership_audit_log.new_data.
// One choke point is much safer than touching every call site.
function scrubAuditPayload(value: unknown): unknown {
  if (value == null) return value
  if (Array.isArray(value)) return value.map(scrubAuditPayload)
  if (typeof value !== "object") return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && /^(email|member_email|applicant_email|to|from)$/i.test(k) && v.includes("@")) {
      out[k] = maskEmail(v)
    } else {
      out[k] = scrubAuditPayload(v)
    }
  }
  return out
}

/**
 * Write a row to `membership_audit_log`. Use this for system/cron/member-
 * lifecycle events (campaign sent, refund initiated, draft expired, etc.).
 *
 * Background: the table was migrated from (target_type, target_id, details)
 * to (entity_type, entity_id, new_data). Every direct supabase.from(...).insert
 * call that still uses the old names fails silently inside a try/catch, so
 * features like campaign stats and cron event history went dark without
 * anyone noticing. Route every write through this helper — the column names
 * live in exactly one place.
 *
 * `entity_id` is NOT NULL in the DB; pass a placeholder (e.g. "bulk") for
 * events that don't map to a single row.
 */
export async function logMembershipAuditEvent(params: {
  action: string
  entityType: string
  entityId: string
  oldData?: Record<string, unknown> | null
  newData?: Record<string, unknown> | null
  performedBy?: string | null
  ipAddress?: string | null
}, supabase?: SupabaseClient): Promise<void> {
  try {
    const db = supabase ?? createAdminClient()
    const { error } = await db.from("membership_audit_log").insert({
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      old_data: params.oldData ? scrubAuditPayload(params.oldData) : null,
      new_data: params.newData ? scrubAuditPayload(params.newData) : null,
      performed_by: params.performedBy ?? null,
      ip_address: params.ipAddress ?? null,
    })
    if (error) {
      console.error("[membership_audit_log] insert failed:", error.message, "| action:", params.action, "| entity:", params.entityType, params.entityId)
    }
  } catch (err) {
    console.error("[membership_audit_log] unexpected error:", err)
  }
}

export async function logAdminAction(params: {
  adminEmail: string
  adminName?: string
  action: string
  entityType: string
  entityId?: string
  entityName?: string
  details?: Record<string, unknown>
  ipAddress?: string
}) {
  try {
    const supabase = createAdminClient()
    const { error } = await supabase.from("admin_audit_log").insert({
      admin_email: params.adminEmail,
      admin_name: params.adminName,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId,
      entity_name: params.entityName,
      details: params.details || null,
      ip_address: params.ipAddress,
    })
    if (error) {
      console.error("Audit log insert failed:", error.message, "| Table: admin_audit_log | Action:", params.action, "| Admin:", params.adminEmail)
    }
  } catch (err) {
    console.error("Audit log error:", err)
  }
}
