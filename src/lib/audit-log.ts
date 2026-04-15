import { createAdminClient } from "@/lib/supabase"

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
