import type { SupabaseClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { sendMemberApprovedWhatsApp } from "@/lib/whatsapp"

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
              <h2 style="color: #1a1a1a;">Welcome, ${displayName}!</h2>
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

  return { success: true, amasiNumber }
}
