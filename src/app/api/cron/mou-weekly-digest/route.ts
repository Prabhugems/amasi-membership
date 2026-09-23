import { createAdminClient } from "@/lib/supabase"
import { buildMouDigestSections } from "@/lib/mou-weekly-digest"
import { sendMouWeeklyDigestEmail } from "@/lib/mou/notify"
import { getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { recordHeartbeat } from "@/lib/cron-heartbeat"

// ---------------------------------------------------------------------------
// GET /api/cron/mou-weekly-digest[?dryRun=true]
//
// MOU-only weekly digest (Part B item 7) — separate from
// src/app/api/cron/weekly-digest/route.ts's membership-KPI digest by design.
// Auth + dryRun mirror src/app/api/cron/mou-report-reminders/route.ts exactly
// (CRON_SECRET bearer or a super_admin session; ?dryRun=true previews the
// sections and recipients without sending). This is a REAL dry-run, unlike
// the membership digest's ?test=1 (which is an auth bypass that still sends)
// — deliberately not reusing that param name here to avoid the confusion.
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

  const dryRun = new URL(request.url).searchParams.get("dryRun") === "true"

  try {
    const sections = await buildMouDigestSections()

    const supabase = createAdminClient()
    const { data: admins, error: adminsError } = await supabase
      .from("admin_users")
      .select("email")
      .eq("is_active", true)
    if (adminsError) throw new Error(`fetch admin_users failed: ${adminsError.message}`)

    const to = (admins ?? []).map((a) => a.email).filter((e): e is string => !!e)
    const secretary = await getRoleAssignment("hon_secretary")
    const cc = secretary ? [secretary.email] : []

    if (dryRun) {
      return Response.json({ dryRun: true, sections, recipients: { to, cc } })
    }

    if (to.length === 0) {
      await recordHeartbeat("mou-weekly-digest", { success: false, error: "no admin recipients found" })
      return Response.json({ error: "No admin emails found" }, { status: 500 })
    }

    await sendMouWeeklyDigestEmail(sections, { to, cc })
    await recordHeartbeat("mou-weekly-digest", { success: true })

    return Response.json({
      sent: true,
      recipients: { to: to.length, cc: cc.length },
      allEmpty: sections.allEmpty,
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    console.error("[mou-weekly-digest] fatal error:", message)
    await recordHeartbeat("mou-weekly-digest", { success: false, error: message })
    return Response.json({ error: "Digest run failed" }, { status: 500 })
  }
}
