import { NextRequest } from "next/server"
import { runBulkDraftReminders } from "@/lib/bulk-draft-reminders"

// Paused 2026-08-21: explicit instruction to stop automated "complete your
// application" nudge emails to incomplete drafts. This was the second of
// two crons doing exactly that (cleanup-drafts.ts's own 5h/18h nudges were
// removed the same day) — this one was missed in that pass because it's a
// separate scheduled job, not called from cleanup-drafts.ts. Also removed
// from vercel.json's crons list; this guard is defense-in-depth for any
// stale schedule registration or manual curl with CRON_SECRET. Does NOT
// affect the admin-triggered manual "Send Reminders" button on /incomplete
// (POST /api/admin/bulk-draft-reminders) — that's a deliberate staff action
// on a different route, calling the same shared runBulkDraftReminders(),
// and stays available.
const CRON_PAUSED = true

export async function GET(request: NextRequest) {
  if (CRON_PAUSED) {
    return Response.json(
      { paused: true, reason: "Automated nudge reminders disabled 2026-08-21 — see route.ts comment" },
      { status: 503 },
    )
  }

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
