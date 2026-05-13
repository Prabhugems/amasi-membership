import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getMemberSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"

// GET /api/member/me — full self-profile for the authenticated member, with
// experience and clinics joined in. Used by amasi-mobile Profile/Card/Settings.
//
// Auth chain (401 vs 403 split is deliberate — the mobile client clears the
// token on 401 only, so 403 keeps the session intact for "contact AMASI"
// states):
//   - No / invalid JWT                                   → 401
//   - Valid JWT but no member row matches session.email  → 403 MEMBER_NOT_FOUND
//   - Member row exists, status !== 'active'             → 403 MEMBERSHIP_INACTIVE
//   - Active member                                      → 200
export async function GET(_request: NextRequest) {
  const session = await getMemberSession()
  if (!session?.email || typeof session.email !== "string") {
    return Response.json(
      { status: false, message: "Authentication required" },
      { status: 401 }
    )
  }

  const email = session.email.toLowerCase().trim()
  const supabase = createAdminClient()

  try {
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("*")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()

    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { route: "api/member/me", op: "member-lookup" },
      })
      return Response.json(
        { status: false, message: "Failed to fetch profile" },
        { status: 500 }
      )
    }

    if (!member) {
      return Response.json(
        {
          status: false,
          code: "MEMBER_NOT_FOUND",
          message:
            "No member record found for this account. Please contact AMASI office.",
        },
        { status: 403 }
      )
    }

    if (member.status !== "active") {
      return Response.json(
        {
          status: false,
          code: "MEMBERSHIP_INACTIVE",
          message:
            "Your membership is not active. Please contact AMASI office.",
        },
        { status: 403 }
      )
    }

    const [
      { data: clinics, error: clinicsErr },
      { data: experiences, error: expErr },
    ] = await Promise.all([
      supabase
        .from("member_clinics")
        .select(
          "id, clinic_name, address, city, state, country, pin_code, phone, is_primary"
        )
        .eq("member_id", member.id)
        .order("is_primary", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("member_experiences")
        .select(
          "id, position, institution, experience_from, experience_to, total_years, is_current"
        )
        .eq("member_id", member.id)
        .order("is_current", { ascending: false })
        .order("created_at", { ascending: false }),
    ])

    if (clinicsErr) {
      Sentry.captureException(clinicsErr, {
        tags: { route: "api/member/me", op: "clinics" },
      })
    }
    if (expErr) {
      Sentry.captureException(expErr, {
        tags: { route: "api/member/me", op: "experiences" },
      })
    }

    const membershipTypeLabel = (() => {
      switch (member.membership_type) {
        case "LM":
          return "Life Member"
        case "ALM":
          return "Associate Life Member"
        case "ACM":
          return "Associate Candidate Member"
        case "ILM":
          return "International Life Member"
        default:
          return member.membership_type || ""
      }
    })()

    const memberSince = (() => {
      if (member.joining_date) return member.joining_date
      if (member.created_at)
        return new Date(member.created_at).toISOString().slice(0, 10)
      return null
    })()

    return Response.json({
      status: true,
      member: {
        id: member.id,
        amasi_number: member.amasi_number,
        salutation: member.salutation || "Dr.",
        name: member.name || "",
        first_name: member.first_name || "",
        middle_name: member.middle_name || "",
        last_name: member.last_name || "",
        father_name: member.father_name || "",
        date_of_birth: member.date_of_birth || "",
        gender: member.gender || "",
        nationality: member.nationality || "",

        email: member.email,
        mobile: member.phone ? String(member.phone) : "",
        mobile_code: member.mobile_code || "+91",
        landline: member.landline || "",
        std_code: member.std_code || "",

        membership_type: member.membership_type || "",
        membership_type_label: membershipTypeLabel,
        application_no: member.application_no || "",
        application_date: member.application_date || null,
        joining_date: member.joining_date || null,
        member_since: memberSince,
        status: member.status,
        profile_photo: member.profile_photo || null,

        street_address_1: member.street_address_1 || "",
        street_address_2: member.street_address_2 || "",
        city: member.city || "",
        state: member.state || "",
        postal_code: member.postal_code || "",
        country: member.country || "India",
        zone: member.zone || "",

        mci_council_number: member.mci_council_number || "",
        mci_council_state: member.mci_council_state || "",
        imr_registration_no: member.imr_registration_no || "",
        asi_membership_no: member.asi_membership_no || "",
        asi_state: member.asi_state || "",
        other_intl_org: member.other_intl_org || "",
        other_intl_org_value: member.other_intl_org_value || "",

        edu_undergrad_degree: member.edu_undergrad_degree || "",
        ug_college: member.ug_college || "",
        ug_university: member.ug_university || "",
        ug_year: member.ug_year || "",
        pg_degree: member.pg_degree || "",
        pg_college: member.pg_college || "",
        pg_university: member.pg_university || "",
        pg_year: member.pg_year || "",
        edu_superspecialty_degree: member.edu_superspecialty_degree || "",
        edu_superspecialty_college: member.edu_superspecialty_college || "",
        edu_superspecialty_university:
          member.edu_superspecialty_university || "",
        edu_superspecialty_year: member.edu_superspecialty_year || "",

        mci_certificate: member.mci_certificate || "",
        pg_degree_certificate: member.pg_degree_certificate || "",
        asi_member_certificate: member.asi_member_certificate || "",
        active_license: member.active_license || "",
        letter_hod: member.letter_hod || "",
        mbbs_degree_certificate: member.mbbs_degree_certificate || "",

        created_at: member.created_at,
        updated_at: member.updated_at,
      },
      experience: experiences || [],
      clinics: clinics || [],
    })
  } catch (e: unknown) {
    Sentry.captureException(e, { tags: { route: "api/member/me" } })
    return Response.json(
      { status: false, message: "Failed to fetch profile" },
      { status: 500 }
    )
  }
}
