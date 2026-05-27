// @auth: public — legacy mobile shim. Apply wizard step 3 submit (multipart).
// Receives education + regulatory + work_exp[] arrays, plus 6 optional file
// fields (mci_certificate, pg_degree_certificate, asi_member_certificate,
// active_license, letter_hod, mbbs_degree_certificate). Files upload to the
// Supabase `uploads` bucket and the URLs are recorded in
// step_data.uploads[<key>] with status:"uploaded" + bypass markers so the
// downstream submit/approve flow routes them to manual review (the shim
// can't run OCR inline — it would push request time past Vercel's serverless
// limits).
//
// See migration/backend-spec.md §29.

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

export const maxDuration = 60

const DOC_FILE_FIELDS = [
  "mci_certificate",
  "pg_degree_certificate",
  "asi_member_certificate",
  "active_license",
  "letter_hod",
  "mbbs_degree_certificate",
] as const

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const draftId = field(form, "id").trim()
    const applicationIdRaw = field(form, "application_id").trim()

    if (!draftId) return legacyErr("Member not found")

    const education = {
      edu_undergrad_degree: field(form, "edu_undergrad_degree"),
      edu_undergrad_college: field(form, "edu_undergrad_college"),
      edu_undergrad_university: field(form, "edu_undergrad_university"),
      edu_undergrad_year: nullableYear(field(form, "edu_undergrad_year")),
      edu_postgrad_degree: field(form, "edu_postgrad_degree"),
      edu_postgrad_college: field(form, "edu_postgrad_college"),
      edu_postgrad_university: field(form, "edu_postgrad_university"),
      edu_postgrad_year: nullableYear(field(form, "edu_postgrad_year")),
      edu_superspecialty_degree: field(form, "edu_superspecialty_degree"),
      edu_superspecialty_college: field(form, "edu_superspecialty_college"),
      edu_superspecialty_university: field(form, "edu_superspecialty_university"),
      edu_superspecialty_year: nullableYear(field(form, "edu_superspecialty_year")),
    }

    const regulatory = {
      mci_council_number: field(form, "mci_council_number"),
      mci_council_state: field(form, "mci_council_state"),
      imr_reg_no: field(form, "imr_reg_no"),
      asi_membership_no: field(form, "asi_membership_no"),
      asi_state: field(form, "asi_state"),
      other_inter_organisation: field(form, "other_inter_organisation"),
      other_inter_organisation_value: field(form, "other_inter_organisation_value"),
    }

    const workProcedure = arrayField(form, "work_procedure")
    const expYear = arrayField(form, "exp_in_year")
    const noOfProcedures1 = arrayField(form, "no_of_procedures1")
    const noOfProcedures2 = arrayField(form, "no_of_procedures2")
    const workExpId = arrayField(form, "work_exp_id")
    const workExperience = workProcedure.map((proc, i) => ({
      id: workExpId[i] || null,
      work_procedure: proc,
      exp_in_year: expYear[i] || "",
      no_of_procedures1: noOfProcedures1[i] || "",
      no_of_procedures2: noOfProcedures2[i] || "",
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
    const newUploads: Record<string, unknown> = { ...existingUploads }

    for (const docKey of DOC_FILE_FIELDS) {
      const f = fileField(form, docKey)
      if (!f || f.size === 0) continue
      try {
        const url = await uploadShimFile(f, docKey, draftId)
        // Mark as bypassed-user so the existing submit/approve gate
        // (validateRequiredDocuments) treats these as passing-to-manual-review
        // rather than rejecting them. The mobile shim can't run OCR inline.
        newUploads[docKey] = {
          fileUrl: url,
          status: "uploaded",
          bypass: true,
          bypassReason: "user_bypass",
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { route: "shim/member_three", op: "doc_upload", doc_key: docKey },
        })
        return legacyErr(`Failed to upload ${docKey}. Please try again.`)
      }
    }

    const mergedStepData = {
      ...existingStepData,
      education,
      regulatory,
      work_experience: workExperience,
      formData: {
        ...((existingStepData.formData as Record<string, unknown>) || {}),
        ...education,
        ...regulatory,
        application_id: applicationIdRaw || (existingStepData.formData as { application_id?: string })?.application_id,
      },
      uploads: newUploads,
    }

    const { error: updateError } = await supabase
      .from("draft_applications")
      .update({
        step_data: mergedStepData,
        current_step: 4,
        updated_at: new Date().toISOString(),
      })
      .eq("id", draftId)

    if (updateError) {
      Sentry.captureException(updateError, {
        tags: { route: "shim/member_three", op: "draft_update" },
      })
      return legacyErr("Failed to save details")
    }

    return legacyOk("Member updated successfully", {
      user_id: draftId,
      application_no: null,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/member_three" } })
    return legacyErr("Something went wrong")
  }
}

function nullableYear(raw: string): string | null {
  if (!raw || raw === "null") return null
  return raw
}
