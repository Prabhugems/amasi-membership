import { createAdminClient } from "@/lib/supabase"
import type { AcademicEventApplication, ApplicationStatus, NewApplicationInput } from "./types"

export async function createApplication(input: NewApplicationInput): Promise<AcademicEventApplication> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("academic_event_applications")
    .insert({ ...input, otp_verified_at: new Date().toISOString() })
    .select()
    .single()
  if (error || !data) throw new Error(error?.message || "Failed to create application")
  return data as AcademicEventApplication
}

export async function getApplicationById(id: string): Promise<AcademicEventApplication | null> {
  const supabase = createAdminClient()
  const { data, error } = await supabase.from("academic_event_applications").select("*").eq("id", id).single()
  if (error || !data) return null
  return data as AcademicEventApplication
}

export async function updateApplicationStatus(
  id: string,
  status: ApplicationStatus,
  fields: Partial<AcademicEventApplication> = {}
): Promise<void> {
  const supabase = createAdminClient()
  await supabase
    .from("academic_event_applications")
    .update({ status, ...fields, updated_at: new Date().toISOString() })
    .eq("id", id)
}

export async function getRoleAssignment(
  role: string
): Promise<{ name: string; email: string; phone: string | null } | null> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from("academic_event_role_assignments")
    .select("name, email, phone")
    .eq("role", role)
    .lte("active_from", today)
    .or(`active_to.is.null,active_to.gte.${today}`)
    .order("active_from", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return data
}

export async function listApplications(filters: {
  type?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<{ rows: AcademicEventApplication[]; total: number }> {
  const supabase = createAdminClient()
  let query = supabase.from("academic_event_applications").select("*", { count: "exact" })
  if (filters.type) query = query.eq("application_type_id", filters.type)
  if (filters.status) query = query.eq("status", filters.status)
  const limit = filters.limit ?? 50
  const offset = filters.offset ?? 0
  const { data, error, count } = await query.order("created_at", { ascending: false }).range(offset, offset + limit - 1)
  if (error) throw new Error(error.message)
  return { rows: (data ?? []) as AcademicEventApplication[], total: count ?? 0 }
}

export async function createRemark(
  applicationId: string,
  authorName: string,
  authorRole: string,
  body: string
): Promise<void> {
  const supabase = createAdminClient()
  await supabase.from("academic_event_remarks").insert({
    application_id: applicationId,
    author_name: authorName,
    author_role: authorRole,
    body,
  })
}

export async function lookupMemberByNumberOrEmail(q: string): Promise<{
  id: string
  name: string
  amasi_number: number
  email: string | null
  phone: string | number | null
  pg_degree: string | null
  state: string | null
} | null> {
  const supabase = createAdminClient()
  const isNumeric = /^\d+$/.test(q.trim())
  const query = supabase.from("members").select("id, name, amasi_number, email, phone, pg_degree, state")
  const { data, error } = isNumeric
    ? await query.eq("amasi_number", parseInt(q.trim(), 10)).limit(1).maybeSingle()
    : await query.eq("email", q.trim().toLowerCase()).limit(1).maybeSingle()
  if (error || !data) return null
  return data
}
