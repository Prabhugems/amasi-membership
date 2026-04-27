// Application utilities: reference numbers, confirmation emails, duplicate detection

import { createAdminClient } from "@/lib/supabase"
export { generateRefNumber } from "@/lib/reference-number"

/**
 * Values containing PostgREST filter-syntax characters (`,` `(` `)` `.` `\` `"`)
 * cannot be safely interpolated into a `.or()` filter string. We reject them
 * before querying rather than building a corrupted filter.
 */
function isUnsafeForOrFilter(value: string): boolean {
  return /[,()."\\]/.test(value)
}

/** Check if an application already exists for this email, phone, or registration number */
export async function checkDuplicateApplication(email: string, mobile: string, mciCouncilNumber?: string): Promise<{
  isDuplicate: boolean
  existingRef?: string
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

  // Check by registration number (catches same doctor, different email)
  if (mciCouncilNumber && mciCouncilNumber.trim()) {
    const regNum = mciCouncilNumber.trim()

    const { data: regApps } = await supabase
      .from("membership_applications")
      .select("id, reference_number, status, name")
      .eq("mci_council_number", regNum)
      .not("status", "eq", "rejected")
      .limit(1)

    if (regApps && regApps.length > 0) {
      return {
        isDuplicate: true,
        existingRef: regApps[0].reference_number,
        message: `An application with registration number ${regNum} already exists (${regApps[0].reference_number}).`,
      }
    }

    const { data: regMembers } = await supabase
      .from("members")
      .select("amasi_number, name")
      .eq("mci_council_number", regNum)
      .limit(1)

    if (regMembers && regMembers.length > 0) {
      return {
        isDuplicate: true,
        message: `MCI/Council registration number ${regNum} is already linked to AMASI member #${regMembers[0].amasi_number}. If this is your number, please contact support.`,
      }
    }
  }

  // Also check members table by email/phone via two separate queries (no filter injection).
  type MemberRow = { amasi_number: number; email: string | null; status: string | null }
  const memberRows: MemberRow[] = []
  if (emailSafe && email) {
    const { data: byEmail } = await supabase
      .from("members")
      .select("amasi_number, email, status")
      .ilike("email", email)
      .limit(1)
    if (byEmail) memberRows.push(...byEmail)
  }
  if (mobileSafe && mobile) {
    const { data: byPhone } = await supabase
      .from("members")
      .select("amasi_number, email, status")
      .eq("phone", mobile)
      .limit(1)
    if (byPhone) memberRows.push(...byPhone)
  }

  if (memberRows.length > 0) {
    return {
      isDuplicate: true,
      message: `An active membership already exists for this email/phone (AMASI #${memberRows[0].amasi_number}).`,
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
