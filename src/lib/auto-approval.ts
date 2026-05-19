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

  // Pre-assignment honoring (mirrors src/app/api/applications/approve/route.ts).
  // When `assigned_amasi_number` is set on a not-yet-approved row, that number
  // is used and the next_amasi_number RPC is skipped — leaving the Postgres
  // sequence head untouched. Used by the legacy-import flow to fill the gap
  // numbers (18260, 18261, 18278–18281) burned by Razorpay webhook retries.
  // Null on every normal application, so AI auto-approval continues to draw
  // from the sequence.
  const preassigned =
    existingApp &&
    existingApp.status !== "approved" &&
    typeof existingApp.assigned_amasi_number === "number"
      ? existingApp.assigned_amasi_number
      : null

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
    .ilike("email", input.email)
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
      const Sentry = await import("@sentry/nextjs")
      Sentry.captureException(linkError, {
        tags: { component: "auto-approval", op: "link-recovery" },
        extra: { applicationId: input.applicationId, email: input.email, amasiNumber: priorMember.amasi_number },
      })
      // Member is real; do not roll back. Caller can retry — the next call will
      // hit this branch again until the application update finally commits.
    }
    return { success: true, amasiNumber: priorMember.amasi_number }
  }

  // Atomic claim. The read-only recovery branches above catch *completed*
  // prior runs; this CAS catches concurrent in-flight runs. Without it,
  // two parallel invocations (e.g. Razorpay webhook + client verify, or
  // webhook retry storms before the first invocation commits) would both
  // read status='submitted', both call next_amasi_number(), and both burn
  // a sequence number — only one survives the members.amasi_number unique
  // constraint, the loser dies and its number is gone forever (gaps
  // 18260-61, 18278-81 originated this way).
  //
  // We transition the row to status='approving' atomically and require the
  // source status to be one of the valid pre-approval states. If 0 rows
  // are updated, another worker is already on it — return success so the
  // webhook caller responds 200 and Razorpay stops retrying.
  //
  // We capture the prior status so we can revert it on a failed approval
  // (sequence RPC failure, member insert failure) to let a future retry
  // re-claim. The `'approving'` value is intentionally not surfaced in any
  // admin UI filter — rows are in this state for milliseconds in the
  // happy path.
  const priorStatus = existingApp?.status ?? "submitted"
  const { data: claimed, error: claimError } = await supabase
    .from("membership_applications")
    .update({ status: "approving", updated_at: new Date().toISOString() })
    .eq("id", input.applicationId)
    .in("status", ["submitted", "pending_review", "ai_approved"])
    .select("id")

  if (claimError) {
    console.error("[auto-approval] claim CAS failed:", claimError)
    return {
      success: false,
      reason: `claim CAS failed: ${claimError.message}`,
      stage: "sequence",
    }
  }

  if (!claimed || claimed.length === 0) {
    // Either another worker already claimed this row (status='approving'),
    // it has since been approved (re-read to recover the assigned number),
    // or it's in a terminal state we don't recognize (admin moved it).
    // The caller (webhook) needs a 2xx so Razorpay stops retrying.
    const { data: latestApp } = await supabase
      .from("membership_applications")
      .select("status, assigned_amasi_number")
      .eq("id", input.applicationId)
      .maybeSingle()

    if (
      latestApp?.status === "approved" &&
      typeof latestApp.assigned_amasi_number === "number"
    ) {
      console.log(
        `[auto-approval] claim CAS lost the race — application ${input.applicationId} was approved by another worker as #${latestApp.assigned_amasi_number}`,
      )
      return { success: true, amasiNumber: latestApp.assigned_amasi_number }
    }

    // Still in-flight ('approving') or in some other state. The other worker
    // owns the outcome; we report success to avoid spurious retries. Caller
    // logs include the amasiNumber so we surface 0 as a sentinel meaning
    // "another worker handled it; check the row directly for the number".
    console.log(
      `[auto-approval] claim CAS returned 0 rows for ${input.applicationId} — another worker holds the claim (latest status=${latestApp?.status ?? "unknown"}), short-circuiting`,
    )
    return { success: true, amasiNumber: latestApp?.assigned_amasi_number ?? 0 }
  }

  // Helper: revert status to prior value so a future retry can re-claim.
  const revertClaim = async (failureReason: string) => {
    const { error: revertErr } = await supabase
      .from("membership_applications")
      .update({ status: priorStatus, updated_at: new Date().toISOString() })
      .eq("id", input.applicationId)
      .eq("status", "approving")
    if (revertErr) {
      console.error("[auto-approval] failed to revert 'approving' status after failure:", revertErr)
      const Sentry = await import("@sentry/nextjs")
      Sentry.captureException(revertErr, {
        tags: { component: "auto-approval", op: "revert-claim" },
        extra: { applicationId: input.applicationId, failureReason, priorStatus },
      })
    }
  }

  // 1. Reserve AMASI number — pre-assigned wins over sequence.
  let amasiNumber: number
  if (preassigned !== null) {
    amasiNumber = preassigned
  } else {
    const { data: nextNumRaw, error: seqError } = await supabase.rpc("next_amasi_number")

    if (seqError || nextNumRaw == null) {
      console.error("[auto-approval] AMASI sequence RPC failed:", seqError)
      await revertClaim(seqError?.message || "sequence RPC returned null")
      return {
        success: false,
        reason: `AMASI sequence RPC failed: ${seqError?.message || "no value returned"}`,
        stage: "sequence",
      }
    }

    amasiNumber = Number(nextNumRaw)
  }

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
    await revertClaim(memberInsertError.message || "member insert failed")
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
    const Sentry = await import("@sentry/nextjs")
    Sentry.captureException(updateError, {
      tags: { component: "auto-approval", op: "post-member-app-update" },
      extra: { applicationId: input.applicationId, amasiNumber },
    })
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
