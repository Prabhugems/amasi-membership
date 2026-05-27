// @auth: public — legacy mobile shim. Apply step-1 gate. The Flutter wizard
// posts (first_name, last_name, email, mobile, [membership_no]) and switches
// on the response's `application_status` string ("YES"/"NO"/"") plus the
// `message` text to decide the next screen. Replicates the 7 legacy branches
// precisely — including the trailing-space messages ("Application under
// review. ", "Member number is wrong. ", "Email already exists. ").
//
// See migration/backend-spec.md §24.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const firstName = field(form, "first_name").trim()
    const lastName = field(form, "last_name").trim()
    const email = field(form, "email").toLowerCase().trim()
    const mobile = field(form, "mobile").trim()
    const mobileCode = field(form, "mobile_code").trim()
    const membershipNo = field(form, "membership_no").trim()

    // Echo the caller's body back in `data` per legacy contract — Flutter
    // re-reads data.email etc on its next screen rather than tracking
    // separately.
    const reqBodyEcho = {
      first_name: firstName,
      last_name: lastName,
      email,
      mobile_code: mobileCode,
      mobile,
      ...(membershipNo ? { membership_no: membershipNo } : {}),
    }

    if (!email) {
      // Legacy doesn't have an explicit "no email" branch; treat as new.
      return legacyOk("New", {
        data: reqBodyEcho,
        application_id: "",
        application_status: "NO",
      })
    }

    const supabase = createAdminClient()

    // Branch 1: membership_no verification (conversion paths 5/6).
    if (membershipNo) {
      const { data: matched } = await supabase
        .from("members")
        .select("id, email, amasi_number")
        .eq("amasi_number", membershipNo)
        .ilike("email", email)
        .limit(1)
        .maybeSingle()
      if (matched) {
        return legacyOk("Member number is verified", {
          data: reqBodyEcho,
          userid: matched.id,
          application_id: null,
          application_status: "NO",
        })
      }
      return Response.json({
        status: false,
        message: "Member number is wrong. ",
      })
    }

    // Branch 2: email already belongs to an active member → redirect to login.
    const { data: existingMember } = await supabase
      .from("members")
      .select("id, email")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()
    if (existingMember) {
      return Response.json({
        status: false,
        err_type: 1,
        message: "Email already exists. ",
      })
    }

    // Branch 3: email has a submitted application not in a terminal state.
    const { data: submittedApp } = await supabase
      .from("membership_applications")
      .select("id, status, reference_number")
      .ilike("email", email)
      .not("status", "in", '("rejected","cancelled","withdrawn")')
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (submittedApp) {
      return Response.json({
        status: false,
        message: "Application under review. ",
      })
    }

    // Branch 4: email has an in-progress draft.
    const { data: draft } = await supabase
      .from("draft_applications")
      .select("id, status, step_data, has_verified_payment")
      .eq("email", email)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (draft) {
      const formDataInDraft = (
        draft.step_data as { formData?: { application_id?: string } } | null
      )?.formData
      return legacyOk("Application already exits", {
        data: reqBodyEcho,
        userid: draft.id,
        application_id: formDataInDraft?.application_id ?? null,
        application_status: "YES",
      })
    }

    // Branch 5 (default): no record anywhere → new applicant.
    return legacyOk("New", {
      data: reqBodyEcho,
      application_id: "",
      application_status: "NO",
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/check_application_status" } })
    return Response.json({
      status: false,
      message: "A network error occurred, or the server is temporarily busy. Please try again later",
    })
  }
}
