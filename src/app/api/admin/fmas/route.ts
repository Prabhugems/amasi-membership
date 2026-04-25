import { createAdminClient } from "@/lib/supabase"

export async function GET() {
  const db = createAdminClient()

  const { data: creds, error } = await db
    .from("member_credentials")
    .select("amasi_number, year, skill_course_id")
    .eq("credential_type", "FMAS")
    .order("year", { ascending: false })
    .order("amasi_number", { ascending: true })
  if (error) {
    return Response.json({ rows: [], error: error.message }, { status: 500 })
  }

  const amasiNumbers = (creds ?? []).map((c) => c.amasi_number)
  const { data: members } = amasiNumbers.length
    ? await db.from("members").select("amasi_number, name").in("amasi_number", amasiNumbers)
    : { data: [] }
  const nameByAmasi = new Map<number, string>()
  for (const m of members ?? []) {
    if (typeof m.amasi_number === "number" && typeof m.name === "string") {
      nameByAmasi.set(m.amasi_number, m.name)
    }
  }

  const years = Array.from(new Set((creds ?? []).map((c) => c.year)))
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

  const rows = (creds ?? []).map((c) => ({
    amasi_number: c.amasi_number,
    name: nameByAmasi.get(c.amasi_number) ?? null,
    year: c.year,
    skill_course_id: c.skill_course_id,
    convocation_place: placeByYear.get(c.year) ?? null,
  }))

  return Response.json({ rows })
}
