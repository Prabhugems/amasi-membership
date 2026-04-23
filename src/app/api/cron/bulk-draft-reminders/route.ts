import { NextRequest } from "next/server"
import { runBulkDraftReminders } from "@/lib/bulk-draft-reminders"

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    console.error("[cron:bulk-draft-reminders] CRON_SECRET not configured")
    return Response.json({ error: "Server misconfiguration" }, { status: 500 })
  }

  const authHeader = request.headers.get("authorization")
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const result = await runBulkDraftReminders("system:cron-bulk-reminder")
    return Response.json({
      status: true,
      sent: result.sent,
      skipped: result.skipped,
      eligible: result.eligibleCount,
    })
  } catch (err) {
    console.error("[cron:bulk-draft-reminders]", err)
    return Response.json(
      { status: false, message: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    )
  }
}
