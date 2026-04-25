import type { SupabaseClient } from "@supabase/supabase-js"
import type { CredentialType, MemberCredential, CredentialTemplate } from "./types"

export async function getCredentialForMember(
  db: SupabaseClient,
  amasiNumber: number,
  type: CredentialType
): Promise<MemberCredential | null> {
  const { data, error } = await db
    .from("member_credentials")
    .select("*")
    .eq("amasi_number", amasiNumber)
    .eq("credential_type", type)
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    amasiNumber: data.amasi_number,
    credentialType: data.credential_type,
    year: data.year,
    skillCourseId: data.skill_course_id,
    awardedAt: data.awarded_at,
    createdAt: data.created_at,
  }
}

export async function getTemplate(
  db: SupabaseClient,
  type: CredentialType,
  year: number
): Promise<CredentialTemplate | null> {
  const { data, error } = await db
    .from("credential_templates")
    .select("*")
    .eq("credential_type", type)
    .eq("year", year)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    credentialType: data.credential_type,
    year: data.year,
    templatePath: data.template_path,
    presidentName: data.president_name,
    convocationDate: data.convocation_date,
    convocationPlace: data.convocation_place,
  }
}

export async function listAllCredentials(
  db: SupabaseClient,
  type: CredentialType
): Promise<MemberCredential[]> {
  const { data, error } = await db
    .from("member_credentials")
    .select("*")
    .eq("credential_type", type)
    .order("year", { ascending: false })
    .order("amasi_number", { ascending: true })
  if (error) throw error
  return (data ?? []).map((r) => ({
    amasiNumber: r.amasi_number,
    credentialType: r.credential_type,
    year: r.year,
    skillCourseId: r.skill_course_id,
    awardedAt: r.awarded_at,
    createdAt: r.created_at,
  }))
}

export async function upsertCredential(
  db: SupabaseClient,
  c: Omit<MemberCredential, "createdAt">
): Promise<void> {
  const { error } = await db.from("member_credentials").upsert(
    {
      amasi_number: c.amasiNumber,
      credential_type: c.credentialType,
      year: c.year,
      skill_course_id: c.skillCourseId,
      awarded_at: c.awardedAt,
    },
    { onConflict: "amasi_number,credential_type,year" }
  )
  if (error) throw error
}

export async function upsertTemplate(
  db: SupabaseClient,
  t: CredentialTemplate
): Promise<void> {
  const { error } = await db.from("credential_templates").upsert(
    {
      credential_type: t.credentialType,
      year: t.year,
      template_path: t.templatePath,
      president_name: t.presidentName,
      convocation_date: t.convocationDate,
      convocation_place: t.convocationPlace,
    },
    { onConflict: "credential_type,year" }
  )
  if (error) throw error
}
