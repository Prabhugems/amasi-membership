// @auth: public — legacy mobile shim. The Flutter v1.0.4+2 binary calls
// this from 7 sites (apply wizard resume, edit, view details, ACM→LM
// conversion, Know flow, member's own profile in Settings). All sites
// post `id` — in practice from Settings.dart:41 this is `hiveMethod.userid`
// = the member's Supabase UUID (set in Login_controller.dart:255 from
// otpVerifyData["data"][0]["id"]).
//
// Returns the legacy MemberInfo shape (per
// AMASI-Mobile-blazingcoders/lib/Models/application_models/member_info_model.dart):
//   {status, message, data: [member_row], clinic: [...], work_exp: [...],
//    payment_status: [...], fmas_data: [...]}
//
// Field mapping members → legacy snake_case is documented inline.
// `member_experiences` table has a different shape than the legacy
// surgical-procedure-count `tbl_work_exp`, so work_exp is returned empty
// today; same for payment_status and fmas_data until we map those.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

// Coerce values that may be null/undefined/bigint to a JSON-safe string.
const str = (v: unknown): string => {
  if (v == null) return ""
  if (typeof v === "string") return v
  return String(v)
}

// Compute age in completed years from a date-of-birth ISO string.
function ageFromDob(dob: string | null | undefined): string {
  if (!dob) return ""
  const d = new Date(dob)
  if (isNaN(d.getTime())) return ""
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const m = now.getMonth() - d.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--
  return age >= 0 ? String(age) : ""
}

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const id = field(form, "id").trim()
    if (!id) return legacyErr("Id is required")

    const supabase = createAdminClient()

    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("*")
      .eq("id", id)
      .limit(1)
      .maybeSingle()

    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { route: "shim/member_info", phase: "member-lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (!member) {
      return legacyErr("Member not found")
    }

    const { data: clinics, error: clinicsErr } = await supabase
      .from("member_clinics")
      .select(
        "id, clinic_name, address, city, state, country, pin_code, phone, is_primary, created_at"
      )
      .eq("member_id", member.id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false })

    if (clinicsErr) {
      Sentry.captureException(clinicsErr, {
        tags: { route: "shim/member_info", phase: "clinics" },
      })
      // Don't fail the whole request on clinics error — return empty list.
    }

    // Legacy MemberInfo.data[0] — map new schema columns to legacy snake_case keys.
    const memberRow = {
      id: member.id,
      application_id: str(member.application_no),
      application_no: str(member.application_no),
      membership_no: member.amasi_number ?? null,
      salutation: str(member.salutation),
      first_name: str(member.first_name),
      middle_name: str(member.middle_name),
      last_name: str(member.last_name),
      email: str(member.email),
      mobile_code: str(member.mobile_code),
      mobile: str(member.phone),
      father_name: str(member.father_name),
      dob: str(member.date_of_birth),
      age: ageFromDob(member.date_of_birth),
      nationality: str(member.nationality),
      zone: str(member.zone),
      gender: str(member.gender),
      street_line1: str(member.street_address_1),
      street_line2: str(member.street_address_2),
      country: str(member.country),
      state: str(member.state),
      city: str(member.city),
      pin: str(member.postal_code),
      landline: str(member.landline),
      stdcode: str(member.std_code),
      mailing_address: "",
      edu_undergrad_degree: str(member.edu_undergrad_degree),
      edu_undergrad_college: str(member.ug_college),
      edu_undergrad_university: str(member.ug_university),
      edu_undergrad_year: str(member.ug_year),
      edu_postgrad_degree: str(member.pg_degree),
      edu_postgrad_college: str(member.pg_college),
      edu_postgrad_university: str(member.pg_university),
      edu_postgrad_year: str(member.pg_year),
      edu_superspecialty_degree: str(member.edu_superspecialty_degree),
      edu_superspecialty_college: str(member.edu_superspecialty_college),
      edu_superspecialty_university: str(member.edu_superspecialty_university),
      edu_superspecialty_year: str(member.edu_superspecialty_year),
      mci_council_number: str(member.mci_council_number),
      mci_council_state: str(member.mci_council_state),
      imr_reg_no: str(member.imr_registration_no),
      asi_membership_no: str(member.asi_membership_no),
      asi_state: str(member.asi_state),
      other_inter_organisation: str(member.other_intl_org),
      other_inter_organisation_value: str(member.other_intl_org_value),
      mci_certificate: str(member.mci_certificate),
      pg_degree_certificate: str(member.pg_degree_certificate),
      asi_member_certificate: str(member.asi_member_certificate),
      active_license: str(member.active_license),
      letter_hod: str(member.letter_hod),
      mbbs_degree_certificate: str(member.mbbs_degree_certificate),
      profile: str(member.profile_photo),
      member_reg_date: str(member.application_date),
      joining_date: str(member.joining_date),
      doc_status: member.status === "active" ? 1 : 0,
      // Legacy sentinel 12 = approved-final. OTP verify already hardcodes 12
      // for any successful login; mirror that here so the in-app profile and
      // the login response agree, regardless of what the DB row's
      // application_status column happens to hold.
      application_status: member.status === "active" ? 12 : (member.application_status ?? 0),
      otp: "",
      otp_verify: "",
      otp_time: "",
    }

    // Legacy clinic[] — map member_clinics columns to legacy tbl_clinic_address
    // field names. address → clinic_address_one, phone → clinic_landline.
    // Columns the legacy app expected but don't exist in the new schema
    // (clinic_address_two, clinic_stdcode, clinic_mailing_address) return "".
    const clinic = (clinics ?? []).map((c) => ({
      id: c.id,
      clinic_name: str(c.clinic_name),
      clinic_address_one: str(c.address),
      clinic_address_two: "",
      clinic_country: str(c.country),
      clinic_state: str(c.state),
      clinic_city: str(c.city),
      clinic_pin_code: str(c.pin_code),
      clinic_stdcode: "",
      clinic_landline: str(c.phone),
      clinic_mailing_address: "",
    }))

    return legacyOk("Member info fetched", {
      data: [memberRow],
      clinic,
      // The new member_experiences table holds (position, institution,
      // dates), not the legacy surgical-procedure-count shape — emit empty
      // until/unless the apply flow starts collecting that data again.
      work_exp: [],
      payment_status: [],
      fmas_data: [],
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/member_info" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST
