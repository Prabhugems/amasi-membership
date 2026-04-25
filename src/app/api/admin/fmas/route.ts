import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase"

interface CredRow {
  amasi_number: number
  year: number
  skill_course_id: number | null
}

interface MemberRow {
  amasi_number: number
  name: string
}

// Supabase caps a single .select() at 1000 rows by default. Page through
// using .range(from, to) until we've fetched everything.
async function fetchAllCredentials(db: SupabaseClient): Promise<CredRow[]> {
  const all: CredRow[] = []
  const PAGE = 1000
  let from = 0
  for (;;) {
    const { data, error } = await db
      .from("member_credentials")
      .select("amasi_number, year, skill_course_id")
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
      .select("amasi_number, name")
      .in("amasi_number", chunk)
    if (error) throw error
    all.push(...((data ?? []) as MemberRow[]))
  }
  return all
}

export async function GET() {
  const db = createAdminClient()

  try {
    const creds = await fetchAllCredentials(db)
    const amasiNumbers = Array.from(new Set(creds.map((c) => c.amasi_number)))

    const members = await fetchMembersByAmasi(db, amasiNumbers)
    const nameByAmasi = new Map<number, string>()
    for (const m of members) nameByAmasi.set(m.amasi_number, m.name)

    const years = Array.from(new Set(creds.map((c) => c.year)))
    const { data: templates } = years.length
      ? await db
          .from("credential_templates")
          .select("year, convocation_place")
          .eq("credential_type", "FMAS")
          .in("year", years)
      : { data: [] }
    const placeByYear = new Map<number, string | null>()
    for (const t of templates ?? []) {
      placeByYear.set(t.year, t.convocation_place ?? null)
    }

    const rows = creds.map((c) => ({
      amasi_number: c.amasi_number,
      name: nameByAmasi.get(c.amasi_number) ?? null,
      year: c.year,
      skill_course_id: c.skill_course_id,
      convocation_place: placeByYear.get(c.year) ?? null,
    }))

    return Response.json({ rows })
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error"
    return Response.json({ rows: [], error: msg }, { status: 500 })
  }
}
