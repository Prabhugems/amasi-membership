import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import {
  partitionEditableUpdates,
  computeFieldDiff,
  deriveZoneFromStateChange,
  FINAL_APPLICATION_STATUSES,
} from "@/lib/edit-application-fields"

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // Defense in depth — middleware already gates /api/applications/[id]/edit-fields
    // behind an admin JWT cookie. This second check protects against any future
    // refactor that exempts the path.
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
    }

    const { id } = await params
    if (!id || !UUID_RE.test(id)) {
      return Response.json(
        { status: false, message: "Invalid application id" },
        { status: 400 },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | { updates?: Record<string, unknown> }
      | null
    const updates = body?.updates
    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return Response.json(
        { status: false, message: "Body must be { updates: object }" },
        { status: 400 },
      )
    }
    if (Object.keys(updates).length === 0) {
      return Response.json(
        { status: false, message: "No fields provided" },
        { status: 400 },
      )
    }

    const { accepted, rejected } = partitionEditableUpdates(updates)
    if (rejected.length > 0) {
      // Surface the exact rejected key set so the client can show a clear
      // error rather than silently dropping them. The rejection IS the
      // signal — see the `app→member field copy` fragile-area note.
      return Response.json(
        {
          status: false,
          message: `Field(s) not editable: ${rejected.join(", ")}`,
          rejected,
        },
        { status: 400 },
      )
    }

    const supabase = createAdminClient()
    const { data: app, error: fetchError } = await supabase
      .from("membership_applications")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !app) {
      return Response.json(
        { status: false, message: "Application not found" },
        { status: 404 },
      )
    }

    if (FINAL_APPLICATION_STATUSES.has(app.status)) {
      return Response.json(
        {
          status: false,
          message: `Cannot edit a ${app.status} application`,
        },
        { status: 400 },
      )
    }

    const diff = computeFieldDiff(app as Record<string, unknown>, accepted)
    if (diff.fieldCount === 0) {
      return Response.json({ status: true, changed: 0, message: "No changes" })
    }

    // If `state` changed, recompute `zone` via STATE_TO_ZONE and include it
    // in both the UPDATE payload and the audit-log diff so reviewers see the
    // derived change explicitly.
    const zoneDerivation = deriveZoneFromStateChange(
      app as Record<string, unknown>,
      diff,
    )
    const updatePayload: Record<string, unknown> = {}
    for (const [key, change] of Object.entries(diff.changes)) {
      updatePayload[key] = change.to
    }
    if ("zone" in zoneDerivation) {
      updatePayload.zone = zoneDerivation.zone
      diff.changes.zone = { from: app.zone ?? null, to: zoneDerivation.zone }
    }
    updatePayload.updated_at = new Date().toISOString()

    const { error: updateError } = await supabase
      .from("membership_applications")
      .update(updatePayload)
      .eq("id", id)

    if (updateError) {
      console.error("[edit-fields] update failed:", updateError)
      Sentry.captureException(updateError, {
        tags: { route: "applications/edit-fields", op: "update" },
        extra: { applicationId: id, fields: Object.keys(diff.changes) },
      })
      return Response.json(
        { status: false, message: "Failed to update application" },
        { status: 500 },
      )
    }

    const fullName =
      [app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") ||
      app.name ||
      "Applicant"

    await logAdminAction({
      adminEmail: (session.email as string) || "unknown",
      adminName: (session.name as string) || undefined,
      action: "edit_application_fields",
      entityType: "application",
      entityId: id,
      entityName: fullName,
      details: {
        changes: diff.changes,
        fieldCount: Object.keys(diff.changes).length,
      },
    })

    return Response.json({
      status: true,
      changed: Object.keys(diff.changes).length,
      fields: Object.keys(diff.changes),
    })
  } catch (error) {
    console.error("[edit-fields] unhandled:", error)
    Sentry.captureException(error, {
      tags: { route: "applications/edit-fields", op: "unhandled" },
    })
    return Response.json(
      { status: false, message: "Failed to update application" },
      { status: 500 },
    )
  }
}
