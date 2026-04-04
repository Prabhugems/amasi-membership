import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getMemberSession, getAdminSession } from "@/lib/auth"

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return Response.json({ status: false, message: "Member ID is required" }, { status: 400 })
  }

  const adminSession = await getAdminSession()
  const memberSession = await getMemberSession()
  if (!adminSession && !memberSession) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { changes } = body as { changes: Record<string, any> }

    if (!changes || Object.keys(changes).length === 0) {
      return Response.json({ status: false, message: "No changes provided" }, { status: 400 })
    }

    // Allowlist of editable columns
    // Locked: email, name, amasi_number, membership_type, mci_council_number
    const allowedColumns = new Set([
      "name", "salutation", "father_name", "date_of_birth", "gender", "nationality",
      "street_address_1", "street_address_2", "city", "state", "postal_code", "country",
      "zone", "landline", "std_code",
      "edu_undergrad_degree", "ug_college", "ug_university", "ug_year",
      "pg_degree", "pg_college", "pg_university", "pg_year",
      "edu_superspecialty_degree", "edu_superspecialty_college",
      "edu_superspecialty_university", "edu_superspecialty_year",
      "mci_council_state", "imr_registration_no",
      "asi_membership_no", "asi_state",
      "profile_photo", "mci_certificate", "pg_degree_certificate",
      "asi_member_certificate", "mbbs_degree_certificate", "active_license", "letter_hod",
    ])

    // Filter to only allowed columns
    const safeChanges: Record<string, any> = {}
    for (const [key, value] of Object.entries(changes)) {
      if (allowedColumns.has(key)) {
        safeChanges[key] = value
      }
    }

    if (Object.keys(safeChanges).length === 0) {
      return Response.json({ status: false, message: "No valid changes" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch current record for audit log
    const { data: current, error: fetchError } = await supabase
      .from("members")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !current) {
      return Response.json({ status: false, message: "Member not found" }, { status: 404 })
    }

    // Build audit diff
    const auditChanges = Object.entries(safeChanges).map(([field, newValue]) => ({
      field,
      old: current[field] ?? null,
      new: newValue,
    }))

    // Update member
    safeChanges.updated_at = new Date().toISOString()
    const { error: updateError } = await supabase
      .from("members")
      .update(safeChanges)
      .eq("id", id)

    if (updateError) {
      console.error("Profile update error:", updateError)
      return Response.json({ status: false, message: "Failed to update profile" }, { status: 500 })
    }

    // Write audit log
    const oldData: Record<string, any> = {}
    const newData: Record<string, any> = {}
    for (const entry of auditChanges) {
      oldData[entry.field] = entry.old
      newData[entry.field] = entry.new
    }
    await supabase.from("membership_audit_log").insert({
      entity_type: "member",
      entity_id: id,
      action: "profile_update",
      old_data: oldData,
      new_data: newData,
      performed_by: "self-service",
      ip_address: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
    }).then(({ error }) => {
      if (error) console.error("Audit log error:", error)
    })

    return Response.json({ status: true, message: "Profile updated successfully" })
  } catch (error: any) {
    console.error("Profile update error:", error)
    return Response.json({ status: false, message: "Update failed" }, { status: 500 })
  }
}
