import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { sendMemberApprovedWhatsApp } from "@/lib/whatsapp"
import { updateAiDecisionOutcome } from "@/lib/ai-decision-log"
import { escapeHtml } from "@/lib/html-escape"

/**
 * Normalized shape used by the auto-approval helper.
 *
 * Callers are responsible for mapping their own data source (camelCase
 * form submissions OR snake_case DB rows) into this shape before invoking.
 */
export interface AutoApprovalInput {
  applicationId: string
  referenceNumber: string

  // Identity
  salutation?: string | null
  firstName?: string | null
  middleName?: string | null
  lastName?: string | null
  fatherName?: string | null
  dateOfBirth?: string | null
  gender?: string | null
  nationality?: string | null

  // Contact
  email: string
  phone?: string | null
  mobileCode?: string | null

  // Membership
  membershipType: string

  // Address
  streetAddress1?: string | null
  streetAddress2?: string | null
  city?: string | null
  state?: string | null
  country?: string | null
  postalCode?: string | null
  zone?: string | null

  // Education
  ugDegree?: string | null
  ugCollege?: string | null
  ugUniversity?: string | null
  ugYear?: string | number | null
  pgDegree?: string | null
  pgCollege?: string | null
  pgUniversity?: string | null
  pgYear?: string | number | null
  ssDegree?: string | null

  // Council / membership refs
  mciCouncilNumber?: string | null
  mciCouncilState?: string | null
  imrRegistrationNo?: string | null
  asiMembershipNo?: string | null
  asiState?: string | null

  // Profile photo URL
  profilePhoto?: string | null

  // Document URLs (from application uploads)
  mciCertificateUrl?: string | null
  pgDegreeCertificateUrl?: string | null
  asiMemberCertificateUrl?: string | null
  mbbsDegreeCertificateUrl?: string | null
  letterHodUrl?: string | null
  activeLicenseUrl?: string | null

  // Notes for review_notes on the application row
  reviewNotes: string
}

export type AutoApprovalResult =
  | { success: true; amasiNumber: number }
  | { success: false; reason: string; stage: "sequence" | "member_insert" | "application_update" }

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

function membershipTypeLabel(type: string): string {
  return type === "LM"
    ? "Life Member"
    : type === "ALM"
      ? "Associate Life Member"
      : type === "ACM"
        ? "Associate Candidate Member"
        : "International Life Member"
}

/**
 * Run the auto-approval flow for an application.
 *
 * Responsibilities:
 *  1. Reserve next AMASI number via `next_amasi_number` RPC.
 *  2. Insert a `members` row.
 *  3. Update the `membership_applications` row to `status = 'approved'`.
 *  4. Send welcome email (Resend) + membership-approved WhatsApp.
 *
 * Failure semantics (caller decides how loud to be):
 *  - If sequence RPC or member insert fails, the helper returns `success: false`.
 *    No application row is updated; caller may mark the app for manual review.
 *  - If application update or notifications fail AFTER the member row exists,
 *    the helper still returns `success: true` (the member is real) and logs
 *    the soft failure. Best-effort — we do not roll back a real member.
 */
export async function autoApproveApplication(
  supabase: SupabaseClient,
  input: AutoApprovalInput,
): Promise<AutoApprovalResult> {
  // Idempotency. Before this guard, a Razorpay webhook retry (it retries up
  // to 4× on non-2xx) would call nextval('amasi_number_seq') again, burn a
  // fresh AMASI number, then fail on the members.email unique constraint and
  // return non-2xx — repeating the cycle and leaving 1-4 lost numbers in the
  // sequence per failed application (see gaps 18260-61, 18278-81). The two
  // checks below short-circuit retries:
  //
  //   1. application.status='approved' AND assigned_amasi_number set:
  //      previous run completed all DB writes — return that number.
  //   2. members row already exists for input.email:
  //      previous run got past member insert but stalled before updating the
  //      application row. Link the application now and return the existing #.
  //
  // Both paths are safe to repeat: they only read or update existing rows;
  // they never advance the sequence.

  const { data: existingApp, error: appLookupError } = await supabase
    .from("membership_applications")
    .select("status, assigned_amasi_number")
    .eq("id", input.applicationId)
    .maybeSingle()

  if (appLookupError) {
    console.error("[auto-approval] application lookup failed:", appLookupError)
    return {
      success: false,
      reason: `application lookup failed: ${appLookupError.message}`,
      stage: "sequence",
    }
  }

  if (
    existingApp?.status === "approved" &&
    typeof existingApp.assigned_amasi_number === "number"
  ) {
    console.log(
      `[auto-approval] retry detected — application ${input.applicationId} already approved as #${existingApp.assigned_amasi_number}, short-circuiting`,
    )
    return { success: true, amasiNumber: existingApp.assigned_amasi_number }
  }

  // Recovery path: member row already created in a prior partial run but the
  // application update never committed. Link the row now without burning a
  // new sequence number.
  const { data: priorMember } = await supabase
    .from("members")
    .select("amasi_number")
    .eq("email", input.email)
    .maybeSingle()

  if (priorMember && typeof priorMember.amasi_number === "number") {
    console.log(
      `[auto-approval] recovery — member already exists for ${input.email} as #${priorMember.amasi_number}, linking application ${input.applicationId}`,
    )
    const { error: linkError } = await supabase
      .from("membership_applications")
      .update({
        status: "approved",
        assigned_amasi_number: priorMember.amasi_number,
        reviewed_at: new Date().toISOString(),
        review_notes: input.reviewNotes,
      })
      .eq("id", input.applicationId)

    if (linkError) {
      console.error(
        "[auto-approval] linking existing member to application failed:",
        linkError,
      )
      // Member is real; do not roll back. Caller can retry — the next call will
      // hit this branch again until the application update finally commits.
    }
    return { success: true, amasiNumber: priorMember.amasi_number }
  }

  // 1. Reserve AMASI number
  const { data: nextNumRaw, error: seqError } = await supabase.rpc("next_amasi_number")

  if (seqError || nextNumRaw == null) {
    console.error("[auto-approval] AMASI sequence RPC failed:", seqError)
    return {
      success: false,
      reason: `AMASI sequence RPC failed: ${seqError?.message || "no value returned"}`,
      stage: "sequence",
    }
  }

  const amasiNumber = Number(nextNumRaw)

  // 2. Create member row
  const fullName = [input.firstName, input.middleName, input.lastName].filter(Boolean).join(" ")
  const memberId = crypto.randomUUID()
  const today = new Date().toISOString().split("T")[0]

  const { error: memberInsertError } = await supabase.from("members").insert({
    id: memberId,
    amasi_number: amasiNumber,
    name: fullName,
    first_name: input.firstName,
    middle_name: input.middleName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone || null,
    mobile_code: input.mobileCode,
    membership_type: input.membershipType,
    status: "active",
    voting_eligible: input.membershipType === "LM",
    salutation: input.salutation,
    father_name: input.fatherName,
    date_of_birth: input.dateOfBirth || null,
    nationality: input.nationality,
    gender: input.gender,
    application_no: input.referenceNumber,
    application_date: today,
    street_address_1: input.streetAddress1,
    street_address_2: input.streetAddress2,
    city: input.city,
    state: input.state,
    country: input.country || "India",
    postal_code: input.postalCode,
    zone: input.zone,
    edu_undergrad_degree: input.ugDegree,
    ug_college: input.ugCollege,
    ug_university: input.ugUniversity,
    ug_year: input.ugYear,
    pg_degree: input.pgDegree,
    pg_college: input.pgCollege,
    pg_university: input.pgUniversity,
    pg_year: input.pgYear,
    edu_superspecialty_degree: input.ssDegree,
    mci_council_number: input.mciCouncilNumber,
    mci_council_state: input.mciCouncilState,
    imr_registration_no: input.imrRegistrationNo,
    asi_membership_no: input.asiMembershipNo,
    asi_state: input.asiState,
    joining_date: today,
    profile_photo: input.profilePhoto || null,
    mci_certificate: input.mciCertificateUrl || null,
    pg_degree_certificate: input.pgDegreeCertificateUrl || null,
    asi_member_certificate: input.asiMemberCertificateUrl || null,
    mbbs_degree_certificate: input.mbbsDegreeCertificateUrl || null,
    letter_hod: input.letterHodUrl || null,
    active_license: input.activeLicenseUrl || null,
  })

  if (memberInsertError) {
    console.error("[auto-approval] member insert failed:", memberInsertError)
    return {
      success: false,
      reason: memberInsertError.message || "member insert failed",
      stage: "member_insert",
    }
  }

  // 3. Update application row. From here on we treat failures as soft —
  // the member row is real, so we must not report failure to the caller.
  const { error: updateError } = await supabase
    .from("membership_applications")
    .update({
      status: "approved",
      assigned_amasi_number: amasiNumber,
      reviewed_by: null,
      reviewed_at: new Date().toISOString(),
      review_notes: input.reviewNotes,
    })
    .eq("id", input.applicationId)

  if (updateError) {
    console.error(
      "[auto-approval] application update failed AFTER member insert — member exists but app row is stale:",
      updateError,
    )
    // fall through; still attempt notifications and return success
  }

  await updateAiDecisionOutcome(supabase, input.applicationId, {
    finalStatus: "approved",
    finalStatusBy: "ai",
  }).catch(err => console.error("[auto-approval] decision outcome update failed:", err))

  // 4. Notifications — best-effort, never throw
  const displayName = [input.salutation, input.firstName].filter(Boolean).join(" ").trim()
    || input.firstName
    || fullName

  try {
    const resend = getResend()
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: input.email,
      subject: `Welcome to AMASI — Membership #${amasiNumber}`,
      html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
                <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
              </div>
              <h2 style="color: #1a1a1a;">Welcome, ${escapeHtml(displayName)}!</h2>
              <p style="color: #555;">Your AMASI membership has been <strong style="color: #16a34a;">approved</strong>.</p>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Your Membership Number</p>
                <p style="font-size: 36px; font-weight: bold; color: #0f766e; margin: 0; font-family: monospace;">${amasiNumber}</p>
                <p style="color: #666; font-size: 13px; margin: 8px 0 0;">${membershipTypeLabel(input.membershipType)}</p>
              </div>
              <p style="color: #555; font-size: 14px;">Reference: ${input.referenceNumber}</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          `,
    })
  } catch (emailErr) {
    console.error("[auto-approval] welcome email failed:", emailErr)
  }

  if (input.phone) {
    const whatsappName = [input.salutation, input.firstName, input.lastName]
      .filter(Boolean)
      .join(" ")
      .trim()
    await sendMemberApprovedWhatsApp(
      input.phone,
      whatsappName,
      membershipTypeLabel(input.membershipType),
      String(amasiNumber),
    ).catch((err) => console.error("[auto-approval] WhatsApp approve error:", err))
  }

  // Auto-add to Zoho Campaigns
  try {
    const { getAccessToken, zohoApi } = await import("@/lib/zoho")
    const token = await getAccessToken()
    if (token) {
      const listKey = process.env.ZOHO_DEFAULT_LIST_KEY
      if (listKey) {
        await zohoApi(`/json/listsubscribe`, {
          method: "POST",
          body: new URLSearchParams({
            listkey: listKey,
            resfmt: "JSON",
            contactinfo: JSON.stringify({
              "Contact Email": input.email,
              "First Name": input.firstName || "",
              "Last Name": input.lastName || "",
            }),
          }),
        })
      }
    }
  } catch { /* non-blocking */ }

  return { success: true, amasiNumber }
}
