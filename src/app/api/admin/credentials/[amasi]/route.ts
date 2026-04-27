import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"

interface CredentialRow {
  credential_type: "FMAS" | "MMAS" | "DIPMAS" | "COURSE_CERT"
  year: number
  skill_course_id: number | null
  awarded_at: string | null
  dispatch_status: string | null
  tracking_number: string | null
  dispatched_at: string | null
  notes: string | null
  course_name: string | null
  course_place: string | null
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ amasi: string }> }
) {
  const admin = await getAdminSession()
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { amasi: amasiStr } = await ctx.params
  const amasi = parseInt(amasiStr, 10)
  if (!Number.isInteger(amasi) || amasi <= 0) {
    return Response.json({ error: "Invalid AMASI number" }, { status: 400 })
  }

  const db = createAdminClient()
  const { data: creds, error } = await db
    .from("member_credentials")
    .select(
      "credential_type, year, skill_course_id, awarded_at, dispatch_status, tracking_number, dispatched_at, notes"
    )
    .eq("amasi_number", amasi)
    .order("year", { ascending: false })

  if (error) return Response.json({ error: error.message }, { status: 500 })

  // Resolve course names in one round trip.
  const lookups = (creds ?? [])
    .filter((c) => c.skill_course_id !== null)
    .map((c) => ({ id: c.skill_course_id as number, type: c.credential_type }))

  let courseByKey = new Map<string, { name: string; place: string | null }>()
  if (lookups.length > 0) {
    const ids = Array.from(new Set(lookups.map((l) => l.id)))
    const types = Array.from(new Set(lookups.map((l) => l.type)))
    const { data: courses } = await db
      .from("skill_courses")
      .select("id, credential_type, name, place")
      .in("id", ids)
      .in("credential_type", types)
    courseByKey = new Map(
      (courses ?? []).map((c) => [
        `${c.id}|${c.credential_type}`,
        { name: c.name, place: c.place },
      ])
    )
  }

  const rows: CredentialRow[] = (creds ?? []).map((c) => {
    const course =
      c.skill_course_id !== null
        ? courseByKey.get(`${c.skill_course_id}|${c.credential_type}`) ?? null
        : null
    return {
      credential_type: c.credential_type,
      year: c.year,
      skill_course_id: c.skill_course_id,
      awarded_at: c.awarded_at,
      dispatch_status: c.dispatch_status,
      tracking_number: c.tracking_number,
      dispatched_at: c.dispatched_at,
      notes: c.notes,
      course_name: course?.name ?? null,
      course_place: course?.place ?? null,
    }
  })

  return Response.json({ amasi_number: amasi, credentials: rows })
}
