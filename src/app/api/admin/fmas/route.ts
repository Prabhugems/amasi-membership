import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase"

interface CredRow {
  amasi_number: number
  year: number
  skill_course_id: number | null
  awarded_at: string | null
  dispatch_status: string | null
  tracking_number: string | null
  dispatched_at: string | null
  notes: string | null
}

interface MemberRow {
  amasi_number: number
  name: string | null
  email: string | null
  // members.phone is bigint in Postgres → JS number at runtime, not string.
  phone: number | null
  city: string | null
  state: string | null
  profile_photo: string | null
}

interface SkillCourseRow {
  id: number
  name: string
  place: string | null
  year: number | null
}

interface FmasResponseRow {
  amasi_number: number
  name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  profile_photo: string | null
  year: number
  awarded_at: string | null
  skill_course_id: number | null
  course_name: string | null
  course_place: string | null
  // legacy per-year fallback (one place per year, often wrong for years
  // that had multiple courses); UI uses it only when course_place is null.
  fallback_place: string | null
  dispatch_status: string | null
  tracking_number: string | null
  dispatched_at: string | null
  notes: string | null
}

interface FmasResponse {
  rows: FmasResponseRow[]
  stats: {
    total: number
    byYear: Array<{ year: number; count: number }>
    byPlace: Array<{ place: string; count: number }>
  }
  facets: {
    years: number[]
    places: string[]
    courses: Array<{ id: number; name: string; place: string | null }>
  }
  warnings: string[]
}

async function fetchAllCredentials(db: SupabaseClient): Promise<CredRow[]> {
  const all: CredRow[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from("member_credentials")
      .select(
        "amasi_number, year, skill_course_id, awarded_at, dispatch_status, tracking_number, dispatched_at, notes"
      )
      .eq("credential_type", "FMAS")
      .order("year", { ascending: false })
      .order("amasi_number", { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    all.push(...(data as CredRow[]))
    if (data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function fetchMembersByAmasi(
  db: SupabaseClient,
  amasiNumbers: number[]
): Promise<MemberRow[]> {
  if (amasiNumbers.length === 0) return []
  const all: MemberRow[] = []
  const CHUNK = 500
  for (let i = 0; i < amasiNumbers.length; i += CHUNK) {
    const chunk = amasiNumbers.slice(i, i + CHUNK)
    const { data, error } = await db
      .from("members")
      .select("amasi_number, name, email, phone, city, state, profile_photo")
      .in("amasi_number", chunk)
    if (error) throw error
    all.push(...((data ?? []) as MemberRow[]))
  }
  return all
}

async function fetchSkillCourses(db: SupabaseClient): Promise<SkillCourseRow[]> {
  const { data, error } = await db
    .from("skill_courses")
    .select("id, name, place, year")
    .eq("credential_type", "FMAS")
  // Table may not yet exist in some environments — surface as empty + warning.
  if (error) {
    if (
      error.message?.toLowerCase().includes("does not exist") ||
      error.code === "42P01"
    ) {
      return []
    }
    throw error
  }
  return (data ?? []) as SkillCourseRow[]
}

export async function GET() {
  const db = createAdminClient()
  const warnings: string[] = []

  try {
    const creds = await fetchAllCredentials(db)
    const amasiNumbers = Array.from(new Set(creds.map((c) => c.amasi_number)))

    const [members, skillCourses] = await Promise.all([
      fetchMembersByAmasi(db, amasiNumbers),
      fetchSkillCourses(db),
    ])

    const memberByAmasi = new Map<number, MemberRow>()
    for (const m of members) memberByAmasi.set(m.amasi_number, m)

    const courseById = new Map<number, SkillCourseRow>()
    for (const c of skillCourses) courseById.set(c.id, c)
    if (skillCourses.length === 0) {
      warnings.push(
        "skill_courses table is empty — run scripts/seed-skill-courses.mjs to populate course names and places."
      )
    }

    const years = Array.from(new Set(creds.map((c) => c.year)))
    const { data: templates } = years.length
      ? await db
          .from("credential_templates")
          .select("year, convocation_place")
          .eq("credential_type", "FMAS")
          .in("year", years)
      : { data: [] }
    const fallbackPlaceByYear = new Map<number, string | null>()
    for (const t of templates ?? []) {
      fallbackPlaceByYear.set(t.year, t.convocation_place ?? null)
    }

    const rows: FmasResponseRow[] = creds.map((c) => {
      const m = memberByAmasi.get(c.amasi_number) ?? null
      const course = c.skill_course_id !== null ? courseById.get(c.skill_course_id) ?? null : null
      return {
        amasi_number: c.amasi_number,
        name: m?.name ?? null,
        email: m?.email ?? null,
        phone: m?.phone != null ? String(m.phone) : null,
        city: m?.city ?? null,
        state: m?.state ?? null,
        profile_photo: m?.profile_photo ?? null,
        year: c.year,
        awarded_at: c.awarded_at,
        skill_course_id: c.skill_course_id,
        course_name: course?.name ?? null,
        course_place: course?.place ?? null,
        fallback_place: fallbackPlaceByYear.get(c.year) ?? null,
        dispatch_status: c.dispatch_status,
        tracking_number: c.tracking_number,
        dispatched_at: c.dispatched_at,
        notes: c.notes,
      }
    })

    // Stats
    const yearCounts = new Map<number, number>()
    const placeCounts = new Map<string, number>()
    for (const r of rows) {
      yearCounts.set(r.year, (yearCounts.get(r.year) ?? 0) + 1)
      const place = r.course_place ?? r.fallback_place ?? null
      if (place) placeCounts.set(place, (placeCounts.get(place) ?? 0) + 1)
    }
    const byYear = Array.from(yearCounts, ([year, count]) => ({ year, count })).sort(
      (a, b) => b.year - a.year
    )
    const byPlace = Array.from(placeCounts, ([place, count]) => ({ place, count })).sort(
      (a, b) => b.count - a.count
    )

    const facets = {
      years: byYear.map((y) => y.year),
      places: byPlace.map((p) => p.place),
      courses: Array.from(courseById.values())
        .map((c) => ({ id: c.id, name: c.name, place: c.place }))
        .sort((a, b) => b.id - a.id),
    }

    const response: FmasResponse = {
      rows,
      stats: { total: rows.length, byYear, byPlace },
      facets,
      warnings,
    }
    return Response.json(response)
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return Response.json(
      {
        rows: [],
        stats: { total: 0, byYear: [], byPlace: [] },
        facets: { years: [], places: [], courses: [] },
        warnings: [],
        error: msg,
      },
      { status: 500 }
    )
  }
}
