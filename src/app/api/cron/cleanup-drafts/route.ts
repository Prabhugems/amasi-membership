import { runCleanupDrafts } from "@/lib/cleanup-drafts"

// Iterates stuck drafts with per-draft Razorpay SDK calls.
export const maxDuration = 60

// ---------------------------------------------------------------------------
// GET /api/cron/cleanup-drafts[?dryRun=true]
//
// Thin route wrapper — auth + dryRun query-param parsing only. All logic
// lives in src/lib/cleanup-drafts.ts (extracted 2026-08-20 so it's testable
// in isolation, matching the pattern already used by
// src/lib/bulk-draft-reminders.ts / api/cron/bulk-draft-reminders/route.ts).
// ---------------------------------------------------------------------------

const CRON_PAUSED = false

export async function GET(request: Request) {
  if (CRON_PAUSED) {
    return Response.json(
      { paused: true, reason: "Coordinator hard-pause pending Issues 1–4 (see SESSION-2026-04-26.md)" },
      { status: 503 },
    )
  }

  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true"

  try {
    const summary = await runCleanupDrafts({ dryRun })
    return Response.json(summary)
  } catch (error: unknown) {
    console.error("[cleanup-drafts] fatal error:", error instanceof Error ? error.message : String(error))
    return Response.json({ error: "Cleanup failed" }, { status: 500 })
  }
}
