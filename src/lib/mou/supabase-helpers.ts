import { createAdminClient } from "@/lib/supabase"
import { signRecordsFields, signStorageValues, toStoragePath } from "@/lib/storage-url"
import type { AcademicEventApplication, ApplicationStatus, NewApplicationInput } from "./types"

// Flat columns on `academic_event_applications` that hold `uploads`-bucket
// paths (or, for rows written before sql/024's Phase B flip, legacy public
// URLs — signStorageValue/toStoragePath normalise either shape). The bucket
// is private, so every reader must sign these fresh rather than render the
// stored value directly.
//
// mou_generated_url is server-only — written exclusively by decide/route.ts,
// never part of POST /api/mou/applications' client allowlist (see the
// comment on pickApplicationInput there) — so it's safe to sign as-is.
const APPLICATION_STORAGE_FIELDS = [
  "mou_generated_url",
  "committee_member_photo_url",
  "institution_photo_url",
  "consent_guest_institution_url",
  "brief_institution_url",
] as const

// The other four flat fields, plus partner_associations[].consent_letter_url
// below, ARE passed through verbatim from client JSON by pickApplicationInput
// — an applicant can set them to any string. The only legitimate source for
// any of them is POST /api/mou/applications/upload, which always writes
// under this one prefix. Without this check, a client could set e.g.
// committee_member_photo_url to another member's mci_certificate path, and
// signing it below (via the service-role client, which bypasses RLS) would
// hand a real signed URL to that unrelated file to whoever reviews this
// application — a confused-deputy / IDOR path into the shared bucket.
const OWNED_UPLOAD_PREFIX = "mou-applications/"

function ownedPathOrNull(value: string | null | undefined, prefix: string = OWNED_UPLOAD_PREFIX): string | null {
  if (!value) return null
  const path = toStoragePath(value)
  return path && path.startsWith(prefix) ? value : null
}

function sanitizeClientSuppliedPaths(app: AcademicEventApplication): AcademicEventApplication {
  // Post-event report documents: POST /api/mou/applications/[id]/report
  // accepts a client-supplied `documents` array (see that route) —
  // restricted to what POST .../report/upload actually wrote for THIS
  // application (`mou-reports/${app.id}/...`), not just the shared
  // `mou-reports/` folder, so a value referencing a different approved
  // application's report can't ride along, for the same confused-deputy
  // reason as OWNED_UPLOAD_PREFIX above. The write route already enforces
  // this per-application scoping; this is read-side defense in depth.
  const ownedReportPrefix = `mou-reports/${app.id}/`
  return {
    ...app,
    committee_member_photo_url: ownedPathOrNull(app.committee_member_photo_url),
    institution_photo_url: ownedPathOrNull(app.institution_photo_url),
    consent_guest_institution_url: ownedPathOrNull(app.consent_guest_institution_url),
    brief_institution_url: ownedPathOrNull(app.brief_institution_url),
    partner_associations: (app.partner_associations ?? []).map((p) => ({
      ...p,
      consent_letter_url: ownedPathOrNull(p.consent_letter_url),
    })),
    report_documents: (app.report_documents ?? []).map((d) => ({
      ...d,
      fileUrl: ownedPathOrNull(d.fileUrl, ownedReportPrefix) ?? "",
    })),
  }
}

/**
 * Sign every stored-path field on a batch of applications, including the two
 * fields that aren't flat columns: `partner_associations[].consent_letter_url`
 * and `report_documents[].fileUrl`. Batches the flat fields and both nested
 * arrays across all rows into two round trips total, not one per row.
 */
export async function signApplicationsStorage(
  applications: AcademicEventApplication[]
): Promise<AcademicEventApplication[]> {
  const sanitized = applications.map(sanitizeClientSuppliedPaths)
  const signedTop = await signRecordsFields(sanitized, APPLICATION_STORAGE_FIELDS)

  const allNestedUrls: string[] = []
  for (const app of signedTop) {
    for (const p of app.partner_associations ?? []) {
      if (p.consent_letter_url) allNestedUrls.push(p.consent_letter_url)
    }
    for (const d of app.report_documents ?? []) {
      if (d.fileUrl) allNestedUrls.push(d.fileUrl)
    }
  }
  if (allNestedUrls.length === 0) return signedTop

  const signedMap = await signStorageValues(allNestedUrls)
  return signedTop.map((app) => ({
    ...app,
    partner_associations: (app.partner_associations ?? []).map((p) => ({
      ...p,
      consent_letter_url: p.consent_letter_url ? signedMap.get(p.consent_letter_url) ?? null : p.consent_letter_url,
    })),
    report_documents: (app.report_documents ?? []).map((d) => ({
      ...d,
      fileUrl: d.fileUrl ? signedMap.get(d.fileUrl) ?? "" : d.fileUrl,
    })),
  }))
}

/** Single-row convenience wrapper around signApplicationsStorage. */
export async function signApplicationStorage(
  application: AcademicEventApplication
): Promise<AcademicEventApplication> {
  const [signed] = await signApplicationsStorage([application])
  return signed
}

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
