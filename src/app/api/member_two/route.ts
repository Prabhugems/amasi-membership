// @auth: public — legacy mobile shim. Apply wizard step 2 submit (multipart).
// Receives personal + address + clinic[] arrays, plus an optional `profile`
// file. Updates draft_applications.step_data with the normalized structure
// the web portal renders. Country/state IDs are translated back to names
// via mobile-geo-data so the web continues to see strings like "India" /
// "Tamil Nadu".
//
// Flutter sets `Authorization: <token>` (no `Bearer ` prefix) on this
// route — we don't validate it here (the legacy backend never did either),
// and the existing /api/applications/save-draft route requires a member JWT
// cookie which the Flutter client doesn't set. Treat the Authorization
// header as advisory.
//
// See migration/backend-spec.md §28.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import {
  legacyOk,
  legacyErr,
  parseLegacyForm,
  field,
  arrayField,
  fileField,
  uploadShimFile,
} from "@/lib/mobile-shim"
import { findCountry, findState } from "@/lib/mobile-geo-data"

export const maxDuration = 30

function resolveCountry(raw: string): string {
  if (!raw) return ""
  const n = parseInt(raw, 10)
  if (Number.isFinite(n)) return findCountry(n)?.country_name ?? raw
  return raw
}

function resolveState(raw: string): string {
  if (!raw) return ""
  const n = parseInt(raw, 10)
  if (Number.isFinite(n)) return findState(n)?.name ?? raw
  return raw
}

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const draftId = field(form, "id").trim()
    const applicationIdRaw = field(form, "application_id").trim()

    if (!draftId) return legacyErr("Member not found")

    const personal = {
      salutation: field(form, "salutation"),
      first_name: field(form, "first_name"),
      middle_name: field(form, "middle_name"),
      last_name: field(form, "last_name"),
      father_name: field(form, "father_name"),
      dob: field(form, "dob").split("T")[0],
      age: field(form, "age"),
      nationality: field(form, "nationality"),
      gender: field(form, "gender"),
      zone: field(form, "zone"),
    }

    const address = {
      street_line1: field(form, "street_line1"),
      street_line2: field(form, "street_line2"),
      country: resolveCountry(field(form, "country")),
      state: resolveState(field(form, "state")),
      city: field(form, "city"),
      pin: field(form, "pin"),
      landline: field(form, "landline"),
      stdcode: field(form, "stdcode"),
      mailing_address: field(form, "mailing_address"),
    }

    const clinicNames = arrayField(form, "clinic_name")
    const clinicAddressOne = arrayField(form, "clinic_address_one")
    const clinicAddressTwo = arrayField(form, "clinic_address_two")
    const clinicCountry = arrayField(form, "clinic_country")
    const clinicState = arrayField(form, "clinic_state")
    const clinicCity = arrayField(form, "clinic_city")
    const clinicPin = arrayField(form, "clinic_pin_code")
    const clinicStdcode = arrayField(form, "clinic_stdcode")
    const clinicLandline = arrayField(form, "clinic_landline")
    const clinicMailing = arrayField(form, "clinic_mailing_address")
    const clinicId = arrayField(form, "clinic_id")

    const clinics = clinicNames.map((name, i) => ({
      id: clinicId[i] || null,
      clinic_name: name,
      clinic_address_one: clinicAddressOne[i] || "",
      clinic_address_two: clinicAddressTwo[i] || "",
      clinic_country: resolveCountry(clinicCountry[i] || ""),
      clinic_state: resolveState(clinicState[i] || ""),
      clinic_city: clinicCity[i] || "",
      clinic_pin_code: clinicPin[i] || "",
      clinic_stdcode: clinicStdcode[i] || "",
      clinic_landline: clinicLandline[i] || "",
      clinic_mailing_address: clinicMailing[i] || "",
    }))

    const supabase = createAdminClient()

    const { data: existing } = await supabase
      .from("draft_applications")
      .select("step_data")
      .eq("id", draftId)
      .maybeSingle()
    if (!existing) return legacyErr("Member not found")

    const existingStepData = (existing.step_data || {}) as Record<string, unknown>
    const existingUploads = (existingStepData.uploads || {}) as Record<string, unknown>

    let profileUrl: string | null = null
    const profileFile = fileField(form, "profile")
    if (profileFile && profileFile.size > 0) {
      try {
        profileUrl = await uploadShimFile(profileFile, "profile", draftId)
      } catch (err) {
        Sentry.captureException(err, {
          tags: { route: "shim/member_two", op: "profile_upload" },
        })
        return legacyErr("Failed to upload profile photo. Please try again.")
      }
    }

    const newUploads: Record<string, unknown> = { ...existingUploads }
    if (profileUrl) {
      newUploads.profile = {
        fileUrl: profileUrl,
        status: "uploaded",
        bypass: true,
        bypassReason: "user_bypass",
      }
    }

    const mergedStepData = {
      ...existingStepData,
      personal,
      address,
      clinics,
      formData: {
        ...((existingStepData.formData as Record<string, unknown>) || {}),
        ...personal,
        ...address,
        application_id: applicationIdRaw || (existingStepData.formData as { application_id?: string })?.application_id,
      },
      uploads: newUploads,
    }

    const { error: updateError } = await supabase
      .from("draft_applications")
      .update({
        step_data: mergedStepData,
        current_step: 3,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)

    if (updateError) {
      Sentry.captureException(updateError, {
        tags: { route: "shim/member_two", op: "draft_update" },
      })
      return legacyErr("Failed to save details")
    }

    return legacyOk("Member updated successfully", {
      user_id: draftId,
      application_no: null,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/member_two" } })
    return legacyErr("Something went wrong")
  }
}
