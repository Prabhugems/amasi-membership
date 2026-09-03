import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"

export async function GET() {
  const admin = await getAdminSession()
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const db = createAdminClient()

  const { data: creds, error } = await db
    .from("member_credentials")
    .select("skill_course_id, year")
    .eq("credential_type", "MMAS")
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = creds ?? []
  const years = Array.from(new Set(rows.map((r) => r.year))).sort((a, b) => b - a)

  const { data: courses } = await db
    .from("skill_courses")
    .select("id, name")
    .eq("credential_type", "MMAS")
  const courseNameById = new Map<number, string>()
  for (const c of courses ?? []) courseNameById.set(c.id, c.name)

  const countByCourse = new Map<number, number>()
  for (const r of rows) {
    if (r.skill_course_id === null) continue
    countByCourse.set(r.skill_course_id, (countByCourse.get(r.skill_course_id) ?? 0) + 1)
  }

  const byCourse = Array.from(countByCourse.entries())
    .map(([id, count]) => ({ id, name: courseNameById.get(id) ?? `Course ${id}`, count }))
    .sort((a, b) => b.count - a.count)

  return Response.json({
    status: true,
    stats: { total: rows.length, byCourse },
    years,
  })
}
