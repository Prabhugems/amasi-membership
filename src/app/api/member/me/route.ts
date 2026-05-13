import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getMemberSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"

// GET /api/member/me — returns the currently authenticated member's full
// profile, plus their clinics and experience entries. Used by the mobile
// app's Profile, Card, and Settings screens.
//
// Auth chain:
//   - No / invalid JWT  → 401 (mobile clears token, redirects to login)
//   - Valid JWT, but no member row matches session.email → 403
//   - Valid JWT, member row exists but status !== 'active' → 403
//   - Active member                                       → 200
//
// 401 vs 403 split is deliberate: the mobile API client clears the token
// on 401 only. 403 keeps the session intact so the app can render a
// "membership not active — contact AMASI office" message instead of
// bouncing the user back to login. (See client.ts in amasi-mobile.)
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
    // Resolve member by email WITHOUT a status filter so we can return a
    // distinct 403 for inactive memberships. Single round-trip — we don't
    // need getAuthenticatedMember()'s pre-flight id-only lookup because
    // we want the full row regardless.
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
          message: "No member record found for this account. Please contact AMASI office.",
        },
        { status: 403 }
      )
    }

    if (member.status !== "active") {
      return Response.json(
        {
          status: false,
          code: "MEMBERSHIP_INACTIVE",
          message: "Your membership is not active. Please contact AMASI office.",
        },
        { status: 403 }
      )
    }

    // Fetch sub-records in parallel — only after the auth gates pass.
    const [{ data: clinics, error: clinicsErr }, { data: experiences, error: expErr }] =
      await Promise.all([
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
          .order("created_at", { ascending: false }),
      ])

    // Sub-record failures are non-fatal — return an empty array and log.
    // A missing clinic list shouldn't 500 the whole profile page.
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

    const nameParts = (member.name || "").trim().split(/\s+/)
    const firstName = nameParts[0] || ""
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : ""

    return Response.json({
      status: true,
      member: {
        id: member.id,
        amasi_number: member.amasi_number,
        name: member.name || "",
        salutation: member.salutation || "Dr.",
        first_name: firstName,
        last_name: lastName,
        father_name: member.father_name || "",
        email: member.email,
        mobile: member.phone ? String(member.phone) : "",
        mobile_code: member.mobile_code || "+91",
        landline: member.landline || "",
        std_code: member.std_code || "",
        date_of_birth: member.date_of_birth || "",
        gender: member.gender || "",
        nationality: member.nationality || "",
        membership_type: member.membership_type || "",
        membership_type_label: membershipTypeLabel,
        application_no: member.application_no || "",
        status: member.status,
        joining_date: member.joining_date || member.created_at || null,
        application_date: member.application_date || null,
        address: {
          street_1: member.street_address_1 || "",
          street_2: member.street_address_2 || "",
          city: member.city || "",
          state: member.state || "",
          postal_code: member.postal_code || "",
          country: member.country || "India",
          zone: member.zone || "",
        },
        profile_photo: member.profile_photo || null,
        mci: {
          council_number: member.mci_council_number || "",
          council_state: member.mci_council_state || "",
        },
        asi: {
          membership_no: member.asi_membership_no || "",
          state: member.asi_state || "",
        },
        imr: {
          registration_no: member.imr_registration_no || "",
        },
        education: {
          undergrad_degree: member.edu_undergrad_degree || "",
          ug_college: member.ug_college || "",
          ug_university: member.ug_university || "",
          ug_year: member.ug_year || "",
          pg_degree: member.pg_degree || "",
          pg_college: member.pg_college || "",
          pg_university: member.pg_university || "",
          pg_year: member.pg_year || "",
          superspecialty_degree: member.edu_superspecialty_degree || "",
          superspecialty_college: member.edu_superspecialty_college || "",
          superspecialty_university: member.edu_superspecialty_university || "",
          superspecialty_year: member.edu_superspecialty_year || "",
        },
      },
      clinics: clinics || [],
      experiences: experiences || [],
    })
  } catch (e: unknown) {
    Sentry.captureException(e, { tags: { route: "api/member/me" } })
    return Response.json(
      { status: false, message: "Failed to fetch profile" },
      { status: 500 }
    )
  }
}
