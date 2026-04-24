import { createAdminClient } from "@/lib/supabase"
import type { SupabaseClient } from "@supabase/supabase-js"

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
      old_data: params.oldData ?? null,
      new_data: params.newData ?? null,
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
