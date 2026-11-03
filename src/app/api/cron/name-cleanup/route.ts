import { runNameCleanup } from "@/lib/name-cleanup"

export const maxDuration = 300

// ---------------------------------------------------------------------------
// GET /api/cron/name-cleanup[?dryRun=true&limit=300]
//
// Thin wrapper — auth + query parsing only; logic and the "what is safe to
// auto-fix" rules live in src/lib/name-cleanup.ts. Same auth shape as
// cleanup-drafts: Vercel cron sends `Bearer CRON_SECRET`; otherwise a
// super_admin session may trigger it by hand (use ?dryRun=true first).
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const params = new URL(request.url).searchParams
  const dryRun = params.get("dryRun") === "true"
  const parsed = Number.parseInt(params.get("limit") ?? "", 10)
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 500) : 300

  try {
    return Response.json(await runNameCleanup({ dryRun, limit }))
  } catch (error: unknown) {
    console.error("[name-cleanup] fatal error:", error instanceof Error ? error.message : String(error))
    return Response.json({ error: "Name cleanup failed" }, { status: 500 })
  }
}
