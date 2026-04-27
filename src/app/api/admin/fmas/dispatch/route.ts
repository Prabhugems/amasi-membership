import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"

interface Body {
  amasi_number: number
  year: number
  dispatch_status?: "pending" | "shipped" | "delivered" | "rto" | "n/a" | null
  tracking_number?: string | null
  notes?: string | null
}

const ALLOWED_STATUS = new Set(["pending", "shipped", "delivered", "rto", "n/a"])

export async function POST(req: Request) {
  const admin = await getAdminSession()
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const amasi = Number(body.amasi_number)
  const year = Number(body.year)
  if (!Number.isInteger(amasi) || amasi <= 0) {
    return Response.json({ error: "amasi_number is required" }, { status: 400 })
  }
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return Response.json({ error: "year is required" }, { status: 400 })
  }

  const status = body.dispatch_status ?? null
  if (status !== null && !ALLOWED_STATUS.has(status)) {
    return Response.json({ error: "Invalid dispatch_status" }, { status: 400 })
  }

  const tracking = body.tracking_number?.trim() || null
  const notes = body.notes?.trim() || null
  const adminEmail = typeof admin.email === "string" ? admin.email : "admin@amasi.org"

  const update: Record<string, unknown> = {
    dispatch_status: status,
    tracking_number: tracking,
    notes,
  }
  // Set/clear dispatched_at based on whether we're recording a shipped state.
  if (status === "shipped" || status === "delivered") {
    update.dispatched_at = new Date().toISOString()
    update.dispatched_by = adminEmail
  } else if (status === null || status === "pending") {
    update.dispatched_at = null
    update.dispatched_by = null
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from("member_credentials")
    .update(update)
    .eq("amasi_number", amasi)
    .eq("credential_type", "FMAS")
    .eq("year", year)
    .select(
      "amasi_number, year, dispatch_status, tracking_number, dispatched_at, dispatched_by, notes"
    )
    .maybeSingle()

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return Response.json({ error: "Credential not found for that AMASI/year" }, { status: 404 })
  }

  await logAdminAction({
    adminEmail,
    adminName: typeof admin.name === "string" ? admin.name : undefined,
    action: "credential_dispatch_updated",
    entityType: "member_credential",
    entityId: `${amasi}-FMAS-${year}`,
    details: { dispatch_status: status, tracking_number: tracking },
  })

  return Response.json({ ok: true, credential: data })
}
