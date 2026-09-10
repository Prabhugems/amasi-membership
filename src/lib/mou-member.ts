/**
 * Resolve the calling member for the /api/mou/* routes.
 *
 * getMemberSession() only proves a member JWT was issued; the applicant must
 * also be a currently-active member (the MOUs require a "bonafide member").
 * Returns the identity snapshot the application row stores — copied from
 * `members`, never from the request body.
 *
 * Routes call getMemberSession() themselves and pass the payload in, so the
 * member-auth signal stays visible in each route file (the middleware
 * allowlist coverage test keys on that literal call).
 */
import type { SupabaseClient } from "@supabase/supabase-js"
import type { JWTPayload } from "jose"

export interface MouApplicant {
  member_id: string
  amasi_number: number | null
  applicant_name: string
  applicant_email: string
  applicant_phone: string | null
  applicant_address: string | null
  member_since: string | null
}

export type MouApplicantResult =
  | { ok: true; applicant: MouApplicant }
  | { ok: false; status: 401 | 403; code: "UNAUTHENTICATED" | "MEMBER_NOT_FOUND" | "MEMBERSHIP_INACTIVE" }

export async function resolveMouApplicant(
  supabase: SupabaseClient,
  session: JWTPayload | null
): Promise<MouApplicantResult> {
  const email = typeof session?.email === "string" ? session.email.toLowerCase().trim() : ""
  if (!email) return { ok: false, status: 401, code: "UNAUTHENTICATED" }

  const { data: member } = await supabase
    .from("members")
    .select(
      "id, amasi_number, salutation, name, first_name, last_name, email, phone, mobile_code, joining_date, created_at, street_address_1, street_address_2, city, state, postal_code, status"
    )
    .ilike("email", email)
    .limit(1)
    .maybeSingle()

  if (!member) return { ok: false, status: 403, code: "MEMBER_NOT_FOUND" }
  if (member.status !== "active") return { ok: false, status: 403, code: "MEMBERSHIP_INACTIVE" }

  const fullName =
    (member.name as string | null)?.trim() ||
    [member.first_name, member.last_name].filter(Boolean).join(" ").trim() ||
    email
  const salutation = (member.salutation as string | null)?.trim()
  const applicant_name = salutation && !fullName.startsWith(salutation) ? `${salutation} ${fullName}` : fullName

  const address = [
    member.street_address_1,
    member.street_address_2,
    member.city,
    member.state,
    member.postal_code,
  ]
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean)
    .join(", ")

  const phone = member.phone != null && String(member.phone).trim()
    ? `${(member.mobile_code as string | null) || "+91"} ${String(member.phone).trim()}`
    : null

  const memberSince =
    (member.joining_date as string | null) ||
    (member.created_at ? new Date(member.created_at as string).toISOString().slice(0, 10) : null)

  return {
    ok: true,
    applicant: {
      member_id: String(member.id),
      amasi_number: typeof member.amasi_number === "number" ? member.amasi_number : null,
      applicant_name,
      applicant_email: (member.email as string) || email,
      applicant_phone: phone,
      applicant_address: address || null,
      member_since: memberSince,
    },
  }
}

export function applicantErrorResponse(result: Extract<MouApplicantResult, { ok: false }>): Response {
  const messages: Record<typeof result.code, string> = {
    UNAUTHENTICATED: "Please sign in with your member email to continue.",
    MEMBER_NOT_FOUND: "No member record found for this account. Please contact AMASI office.",
    MEMBERSHIP_INACTIVE: "Your membership is not active. Please contact AMASI office.",
  }
  return Response.json(
    { status: false, code: result.code, message: messages[result.code] },
    { status: result.status }
  )
}
