// Application utilities: reference numbers, confirmation emails, duplicate detection

import { createAdminClient } from "@/lib/supabase"
import * as Sentry from "@sentry/nextjs"
export { generateRefNumber } from "@/lib/reference-number"

/**
 * Values containing PostgREST filter-syntax characters (`,` `(` `)` `.` `\` `"`)
 * cannot be safely interpolated into a `.or()` filter string. We reject them
 * before querying rather than building a corrupted filter.
 */
function isUnsafeForOrFilter(value: string): boolean {
  return /[,()."\\]/.test(value)
}

export interface ExistingMember {
  amasi_number: number
  name: string | null
  email: string | null
  membership_type: string | null
}

/**
 * Decide whether an applicant's state and a matched record's state should be
 * treated as the same registration. Policy: exact case-insensitive match
 * counts; either side missing (null/empty) falls back to "match" so we stay
 * over-cautious on legacy data. Returns null only when BOTH sides have a
 * non-empty state AND they differ — that's the cross-state false positive
 * we want to stop blocking on (e.g. Goa #3462 vs Jharkhand #3462, two
 * legitimately different doctors).
 *
 * Exported for the throwaway dup-check test; not consumed elsewhere.
 */
export function evaluateStateMatch(
  applicantState: string | null | undefined,
  matchedRowState: string | null | undefined,
): { matches: true; reason: "state_match" | "null_state_fallback" } | null {
  const a = (applicantState ?? "").trim().toLowerCase()
  const b = (matchedRowState ?? "").trim().toLowerCase()
  if (a === "" || b === "") return { matches: true, reason: "null_state_fallback" }
  if (a === b) return { matches: true, reason: "state_match" }
  return null
}

/** Check if an application already exists for this email, phone, or registration number */
export async function checkDuplicateApplication(email: string, mobile: string, mciCouncilNumber?: string, mciCouncilState?: string): Promise<{
  isDuplicate: boolean
  existingRef?: string
  existingMember?: ExistingMember
  message?: string
}> {
  const supabase = createAdminClient()

  // Check membership_applications table by email/phone using two separate queries
  // (instead of a string-interpolated .or() which is vulnerable to filter injection
  // when values contain commas/parens/dots/quotes).
  const emailSafe = !isUnsafeForOrFilter(email)
  const mobileSafe = !isUnsafeForOrFilter(mobile)

  type AppRow = { id: string; reference_number: string; status: string; created_at: string }
  const appRows: AppRow[] = []
  if (emailSafe && email) {
    const { data: byEmail } = await supabase
      .from("membership_applications")
      .select("id, reference_number, status, created_at")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
    if (byEmail) appRows.push(...byEmail)
  }
  if (mobileSafe && mobile) {
    const { data: byMobile } = await supabase
      .from("membership_applications")
      .select("id, reference_number, status, created_at")
      .eq("phone", mobile)
      .order("created_at", { ascending: false })
      .limit(1)
    if (byMobile) appRows.push(...byMobile)
  }

  // Pick the most-recently-created row across both queries
  appRows.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
  const data = appRows.slice(0, 1)

  if (data.length > 0) {
    const app = data[0]
    // `ai_approved` is included to close the race where an application has been
    // auto-approved but the `members` row creation is still in-flight — a second
    // submission with the same email could otherwise sneak past the dup check.
    if (
      app.status === "pending" ||
      app.status === "pending_payment" ||
      app.status === "submitted" ||
      app.status === "under_review" ||
      app.status === "pending_review" ||
      app.status === "ai_approved"
    ) {
      return {
        isDuplicate: true,
        existingRef: app.reference_number,
        message: `You already have a pending application (${app.reference_number}). Please wait for it to be processed.`,
      }
    }
  }

  // Check by registration number — state-aware per policy. When applicant
  // state AND matched-row state are both present, both must agree
  // (case-insensitive, trimmed) for a block. Either side missing → fall
  // back to number-only match (we'd rather wrongly block a real applicant —
  // recoverable via support — than wrongly admit a duplicate). Closes the
  // cross-state false positive where two doctors in different state
  // councils legitimately share a number (e.g. Goa #3462 vs Jharkhand #3462).
  if (mciCouncilNumber && mciCouncilNumber.trim()) {
    const regNum = mciCouncilNumber.trim()
    const applicantState = (mciCouncilState ?? "").trim()

    // Fetch all reg-number-matching applications (excluding rejected), then
    // narrow by state in JS — the NULL-fallback policy is conditional and
    // doesn't translate cleanly into a single .eq() chain. limit(100) is a
    // defensive ceiling: India has ~35 state medical councils; even if every
    // council issued the same number and every holder joined AMASI, 100 is
    // comfortable headroom. The query is indexed on mci_council_number.
    const { data: regApps } = await supabase
      .from("membership_applications")
      .select("id, reference_number, status, name, mci_council_state")
      .eq("mci_council_number", regNum)
      .not("status", "eq", "rejected")
      .limit(100)

    for (const row of regApps || []) {
      const verdict = evaluateStateMatch(applicantState, row.mci_council_state)
      if (verdict) {
        Sentry.captureMessage("Duplicate registration-number block", {
          level: "warning",
          fingerprint: ["dup-check-blocked", "applications"],
          tags: {
            component: "duplicate-check",
            matched_table: "applications",
            reason: verdict.reason,
          },
          extra: {
            registration_number: regNum,
            applicant_state: applicantState || null,
            matched_record_state: row.mci_council_state || null,
            matched_reference: row.reference_number,
            matched_status: row.status,
          },
        })
        return {
          isDuplicate: true,
          existingRef: row.reference_number,
          message: `An application with registration number ${regNum} already exists (${row.reference_number}).`,
        }
      }
    }

    const { data: regMembers } = await supabase
      .from("members")
      .select("amasi_number, name, mci_council_state")
      .eq("mci_council_number", regNum)
      .limit(100)

    for (const row of regMembers || []) {
      const verdict = evaluateStateMatch(applicantState, row.mci_council_state)
      if (verdict) {
        Sentry.captureMessage("Duplicate registration-number block", {
          level: "warning",
          fingerprint: ["dup-check-blocked", "members"],
          tags: {
            component: "duplicate-check",
            matched_table: "members",
            reason: verdict.reason,
          },
          extra: {
            registration_number: regNum,
            applicant_state: applicantState || null,
            matched_record_state: row.mci_council_state || null,
            matched_amasi_number: row.amasi_number,
          },
        })
        return {
          isDuplicate: true,
          message: `MCI/Council registration number ${regNum} is already linked to AMASI member #${row.amasi_number}. If this is your number, please contact support.`,
        }
      }
    }
  }

  // Also check members table by email/phone via two separate queries (no filter injection).
  type MemberRow = { amasi_number: number; name: string | null; email: string | null; membership_type: string | null; status: string | null }
  const memberRows: MemberRow[] = []
  if (emailSafe && email) {
    const { data: byEmail } = await supabase
      .from("members")
      .select("amasi_number, name, email, membership_type, status")
      .ilike("email", email)
      .limit(1)
    if (byEmail) memberRows.push(...byEmail)
  }
  if (mobileSafe && mobile) {
    const { data: byPhone } = await supabase
      .from("members")
      .select("amasi_number, name, email, membership_type, status")
      .eq("phone", mobile)
      .limit(1)
    if (byPhone) memberRows.push(...byPhone)
  }

  if (memberRows.length > 0) {
    const m = memberRows[0]
    return {
      isDuplicate: true,
      existingMember: {
        amasi_number: m.amasi_number,
        name: m.name,
        email: m.email,
        membership_type: m.membership_type,
      },
      message: `An active membership already exists for this email/phone (AMASI #${m.amasi_number}).`,
    }
  }

  return { isDuplicate: false }
}

/** Field help tooltips */
export const FIELD_HELP: Record<string, string> = {
  mciCouncilNumber: "Your State Medical Council or MCI/NMC registration number. Found on your registration certificate.",
  mciCouncilState: "The state medical council where you are registered.",
  asiMembershipNo: "Your ASI (Association of Surgeons of India) life membership number. Required for LM category.",
  imrRegNo: "Indian Medical Register number issued by NMC (formerly MCI). Optional but recommended.",
  eduPostgradDegree: "Your postgraduate surgical degree (MS, MCh, DNB in surgical specialty).",
  pin: "6-digit Indian postal PIN code. Auto-fills city and state.",
  dob: "Date of birth as on your medical documents.",
}
