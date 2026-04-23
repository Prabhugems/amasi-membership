import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import {
  runBulkDraftReminders,
  countEligibleDrafts,
  DEFAULT_MIN_HOURS_IDLE,
} from "@/lib/bulk-draft-reminders"

export async function GET() {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const eligibleCount = await countEligibleDrafts()
  return Response.json({
    status: true,
    eligible_count: eligibleCount,
    min_hours_idle: DEFAULT_MIN_HOURS_IDLE,
  })
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const actor = typeof session.email === "string" ? `admin:${session.email}` : "admin"

  try {
    const result = await runBulkDraftReminders(actor, {
      minHoursIdle: typeof body.minHoursIdle === "number" ? body.minHoursIdle : undefined,
    })
    return Response.json({
      status: true,
      sent: result.sent,
      skipped: result.skipped,
      skippedDetails: result.skippedDetails,
    })
  } catch (err) {
    console.error("[admin bulk-draft-reminders]", err)
    return Response.json({ status: false, message: err instanceof Error ? err.message : "Failed" }, { status: 500 })
  }
}
