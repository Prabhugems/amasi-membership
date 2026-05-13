import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getMemberSession, getAdminSession } from "@/lib/auth"
import { verifyMemberOwnership } from "@/lib/member-ownership"

export async function POST(
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

  // X-Idempotency-Key is honored for member sessions only. Mobile clients
  // replay the same key on offline-retry; the dedupe prevents double audit
  // log rows and double campaign attribution. Admin sessions don't have an
  // offline outbox, so the header is ignored on the admin path.
  let idempotencyKey: string | null = null
  if (!adminSession && memberSession) {
    const raw = request.headers.get("x-idempotency-key")
    if (raw !== null) {
      const trimmed = raw.trim()
      if (!trimmed || trimmed.length > 128) {
        return Response.json(
          { status: false, message: "Invalid X-Idempotency-Key" },
          { status: 400 }
        )
      }
      idempotencyKey = trimmed
    }
  }

  try {
    const body = await request.json()
    const { changes } = body as { changes: Record<string, unknown> }

    if (!changes || Object.keys(changes).length === 0) {
      return Response.json({ status: false, message: "No changes provided" }, { status: 400 })
    }

    // Base allowlist for member self-service.
    // Members cannot self-change name, email, phone, amasi_number,
    // membership_type, or mci_council_number — these are credentialed
    // fields that require AMASI office support.
    const allowedColumns = new Set([
      "salutation", "father_name", "date_of_birth", "gender", "nationality",
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

    // Admin has broader edit access — can change credentialed fields and
    // sign-in identity. Kept locked for everyone: id, amasi_number,
    // application_no, created_at, joining_date.
    if (adminSession) {
      allowedColumns.add("name")
      allowedColumns.add("email")
      allowedColumns.add("phone")
      allowedColumns.add("mobile_code")
      allowedColumns.add("mci_council_number")
      allowedColumns.add("membership_type")
      allowedColumns.add("voting_eligible")
    }

    // Filter to only allowed columns
    const safeChanges: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(changes)) {
      if (allowedColumns.has(key)) {
        safeChanges[key] = value
      }
    }

    if (Object.keys(safeChanges).length === 0) {
      return Response.json({ status: false, message: "No valid changes" }, { status: 400 })
    }

    // Basic email validation when admin updates it
    if (adminSession && Object.prototype.hasOwnProperty.call(safeChanges, "email")) {
      const newEmail = String(safeChanges.email || "").trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return Response.json({ status: false, message: "Invalid email address" }, { status: 400 })
      }
      safeChanges.email = newEmail
    }

    const supabase = createAdminClient()

    // IDOR guard: non-admin members may only edit their own record
    if (!adminSession && memberSession?.email) {
      const ok = await verifyMemberOwnership(supabase, String(memberSession.email), id)
      if (!ok) return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    // Idempotency replay: if this (member, key) pair already applied, return
    // the cached success without re-touching the row, audit log, or campaign
    // attribution. The race where two duplicates land in parallel is handled
    // below by ON CONFLICT on the INSERT — both will see the row on the next
    // attempt and short-circuit here.
    if (idempotencyKey) {
      const { data: prior } = await supabase
        .from("profile_edit_log")
        .select("id")
        .eq("member_id", id)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle()
      if (prior) {
        return Response.json({
          status: true,
          message: "Profile updated successfully",
          idempotent_replay: true,
        })
      }
    }

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
      const isUniqueViolation = (updateError as { code?: string }).code === "23505"
      const emailChanged = Object.prototype.hasOwnProperty.call(safeChanges, "email")
      if (isUniqueViolation && emailChanged) {
        return Response.json(
          { status: false, message: "That email is already in use by another member" },
          { status: 409 }
        )
      }
      return Response.json({ status: false, message: "Failed to update profile" }, { status: 500 })
    }

    // Write audit log
    const oldData: Record<string, unknown> = {}
    const newData: Record<string, unknown> = {}
    for (const entry of auditChanges) {
      oldData[entry.field] = entry.old
      newData[entry.field] = entry.new
    }
    const performedBy = adminSession
      ? `admin:${String((adminSession as { email?: string; username?: string }).email ?? (adminSession as { email?: string; username?: string }).username ?? "unknown")}`
      : "self-service"
    try {
      const { error: auditErr } = await supabase.from("membership_audit_log").insert({
        entity_type: "member",
        entity_id: id,
        action: "profile_update",
        old_data: oldData,
        new_data: newData,
        performed_by: performedBy,
        ip_address: request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || null,
      })
      if (auditErr) {
        Sentry.captureException(auditErr, {
          tags: { route: "members/[id]/update", op: "audit-log" },
        })
      }
    } catch (e: unknown) {
      Sentry.captureException(e, {
        tags: { route: "members/[id]/update", op: "audit-log" },
      })
    }

    // Idempotency log: claim the (member_id, key) pair so future retries
    // hit the early-return above. The UNIQUE (member_id, idempotency_key)
    // constraint handles the rare parallel-dupe race where both requests
    // passed the lookup — the loser gets 23505 and we treat it as a no-op.
    // The UPDATE itself is idempotent (same safeChanges → same row), so we
    // accept the duplicate update side-effect of the race.
    if (idempotencyKey) {
      const { error: idemErr } = await supabase.from("profile_edit_log").insert({
        member_id: id,
        idempotency_key: idempotencyKey,
        fields_changed: Object.keys(safeChanges).filter((k) => k !== "updated_at"),
      })
      // 23505 = unique violation (concurrent dupe). Harmless, don't log.
      if (idemErr && (idemErr as { code?: string }).code !== "23505") {
        Sentry.captureException(idemErr, {
          tags: { route: "members/[id]/update", op: "idempotency-log" },
        })
      }
    }

    // Campaign attribution: credit the most recent relevant recipient row.
    // Only NULL → not-NULL transitions are counted (per the attribution rule).
    try {
      const nullToValue = auditChanges
        .filter((e) => (e.old === null || e.old === undefined || e.old === "") && e.new)
        .map((e) => e.field)
      if (nullToValue.length > 0) {
        const { creditUpdateIfRelevant } = await import("@/lib/campaigns/attribution")
        await creditUpdateIfRelevant({
          memberId: id,
          changedFields: nullToValue,
          at: new Date().toISOString(),
          supabase,
        })
      }
    } catch (err) {
      console.error("campaign attribution error:", err)
    }

    return Response.json({ status: true, message: "Profile updated successfully" })
  } catch (error: unknown) {
    console.error("Profile update error:", error)
    return Response.json({ status: false, message: "Update failed" }, { status: 500 })
  }
}
