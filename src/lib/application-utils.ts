// Application utilities: reference numbers, confirmation emails, duplicate detection

import { createAdminClient } from "@/lib/supabase"

/** Generate a unique application reference number: AMASI-2026-XXXXX */
export function generateRefNumber(): string {
  const year = new Date().getFullYear()
  const random = Math.floor(10000 + Math.random() * 90000)
  return `AMASI-${year}-${random}`
}

/** Check if an application already exists for this email, phone, or registration number */
export async function checkDuplicateApplication(email: string, mobile: string, mciCouncilNumber?: string): Promise<{
  isDuplicate: boolean
  existingRef?: string
  message?: string
}> {
  const supabase = createAdminClient()

  // Check membership_applications table by email/phone
  const { data } = await supabase
    .from("membership_applications")
    .select("id, reference_number, status, created_at")
    .or(`email.eq.${email},mobile.eq.${mobile}`)
    .order("created_at", { ascending: false })
    .limit(1)

  if (data && data.length > 0) {
    const app = data[0]
    if (app.status === "pending" || app.status === "submitted" || app.status === "under_review" || app.status === "pending_review") {
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
        message: `Registration number ${regNum} is already linked to AMASI member #${regMembers[0].amasi_number}.`,
      }
    }
  }

  // Also check members table by email/phone
  const { data: members } = await supabase
    .from("members")
    .select("amasi_number, email, status")
    .or(`email.ilike.${email},phone.eq.${mobile}`)
    .limit(1)

  if (members && members.length > 0) {
    return {
      isDuplicate: true,
      message: `An active membership already exists for this email/phone (AMASI #${members[0].amasi_number}).`,
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
