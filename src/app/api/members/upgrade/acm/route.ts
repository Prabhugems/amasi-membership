import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { Resend } from "resend"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { verifyMemberOwnership } from "@/lib/member-ownership"
import { checkRateLimit } from "@/lib/rate-limit"
import { extractDocument } from "@/lib/document-extraction"
import { logMembershipAuditEvent } from "@/lib/audit-log"
import { escapeHtml } from "@/lib/html-escape"

// Member-submitted upgrade for Associate Candidate Members (PG trainees).
//
//   ACM + completed PG degree                  -> ALM
//   ACM + completed PG degree + ASI membership -> LM
//
// The SERVER decides the target type from what it verifies; the client only
// supplies evidence. Auto-activation requires every check to pass; anything
// uncertain is queued as pending_review for an admin (reviewed through
// PATCH /api/members/upgrade/[id], which honours to_type).

const MAX_FILE_BYTES = 5 * 1024 * 1024

function bad(message: string, status = 400) {
  return Response.json({ status: false, message }, { status })
}

function validateFile(file: File, label: string): Promise<string | null> {
  return (async () => {
    if (file.size > MAX_FILE_BYTES) return `${label} exceeds 5 MB limit`
    const h = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    const ok =
      (h[0] === 0xff && h[1] === 0xd8) || // JPEG
      (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) || // PNG
      (h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46) // PDF
    return ok ? null : `${label}: only JPG, PNG, and PDF files are accepted`
  })()
}

function nameTokens(value: string | null | undefined): string[] {
  return (value || "")
    .toLowerCase()
    .replace(/\b(dr|prof|mr|mrs|ms|shri|smt)\b\.?/g, " ")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2)
}

/** At least two distinct member-name tokens (or the only one) appear in the document name. */
function namesMatch(memberName: string | null | undefined, docName: string | null | undefined): boolean {
  const member = Array.from(new Set(nameTokens(memberName)))
  const doc = new Set(nameTokens(docName))
  if (member.length === 0 || doc.size === 0) return false
  const hits = member.filter((t) => doc.has(t)).length
  return member.length === 1 ? hits === 1 : hits >= 2
}

function normId(v: unknown): string {
  return String(v ?? "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

async function readExtraction(file: File, docType: string) {
  const buffer = Buffer.from(await file.arrayBuffer())
  return extractDocument({ buffer, fileName: file.name, docType })
}

async function storeFile(
  supabase: ReturnType<typeof createAdminClient>,
  memberId: string,
  file: File,
  label: string
): Promise<string | null> {
  const ext = (file.name.split(".").pop() || "pdf").replace(/[^a-zA-Z0-9]/g, "").slice(0, 5) || "pdf"
  const path = `upgrades/${memberId}/${label}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from("uploads").upload(path, file, { upsert: false })
  if (error) {
    Sentry.captureException(error, { tags: { route: "members/upgrade/acm", op: "storage-upload" }, extra: { label } })
    return null
  }
  return path
}

export async function POST(request: NextRequest) {
  try {
    const adminSession = await getAdminSession()
    const memberSession = adminSession ? null : await getMemberSession()
    if (!adminSession && !memberSession) return bad("Unauthorized", 401)

    const rl = await checkRateLimit(
      `upgrade-acm:${(memberSession?.email as string) || (adminSession?.email as string) || "unknown"}`,
      5,
      15 * 60 * 1000
    )
    if (!rl.allowed) return bad("Too many attempts. Please try again later.", 429)

    const formData = await request.formData()
    const dataStr = formData.get("data")
    if (typeof dataStr !== "string") return bad("No data provided")

    let data: { memberId?: string; asiMembershipNo?: string; asiState?: string }
    try {
      data = JSON.parse(dataStr)
    } catch {
      return bad("Invalid request data")
    }
    const memberId = data.memberId
    if (!memberId) return bad("Missing member")
    const asiClaimed = (data.asiMembershipNo || "").trim()
    const asiState = (data.asiState || "").trim() || null

    const supabase = createAdminClient()

    if (!adminSession && memberSession?.email) {
      const owns = await verifyMemberOwnership(supabase, memberSession.email as string, memberId)
      if (!owns) return bad("Forbidden", 403)
    }

    const { data: member } = await supabase
      .from("members")
      .select("id, name, email, amasi_number, membership_type")
      .eq("id", memberId)
      .maybeSingle()
    if (!member) return bad("Member not found", 404)

    const currentType = (member.membership_type || "").toUpperCase()
    if (!(currentType === "ACM" || currentType.includes("CANDIDATE"))) {
      return bad("This upgrade is only for Associate Candidate Members")
    }

    const { data: existing } = await supabase
      .from("membership_upgrades")
      .select("id, status")
      .eq("member_id", member.id)
      .in("status", ["pending", "pending_review", "approved"])
      .limit(1)
    if (existing && existing.length > 0) {
      return bad(
        existing[0].status === "approved"
          ? "Your upgrade has already been approved"
          : "You already have a pending upgrade request"
      )
    }

    const pgFile = formData.get("pg_degree")
    if (!(pgFile instanceof File) || pgFile.size === 0) return bad("Please upload your PG degree certificate")
    const pgErr = await validateFile(pgFile, "PG degree certificate")
    if (pgErr) return bad(pgErr)

    let asiFile: File | null = null
    if (asiClaimed) {
      if (asiClaimed.length < 2 || asiClaimed.length > 20) return bad("ASI membership number looks invalid")
      const f = formData.get("asi_certificate")
      if (!(f instanceof File) || f.size === 0) return bad("Please upload your ASI certificate with your ASI number")
      const err = await validateFile(f, "ASI certificate")
      if (err) return bad(err)
      asiFile = f
    }

    // ---- Verify the PG degree -------------------------------------------------
    const notes: string[] = []
    const pg = await readExtraction(pgFile, "pg_degree_certificate")
    const pgX = pg.extracted || {}
    const thisYear = new Date().getFullYear()
    const yearOfPassing = parseInt(String(pgX.year_of_passing || "").match(/\d{4}/)?.[0] || "0", 10)

    let degreeVerified = true
    if (pg.engineError || !pg.isValid) {
      degreeVerified = false
      notes.push(pg.engineError ? "PG degree could not be read automatically" : `PG degree rejected: ${pg.rejectionReason || "not a valid degree certificate"}`)
    } else {
      if (!pg.eligibility || pg.eligibility.eligible !== true || pg.eligibility.softBlock) {
        degreeVerified = false
        notes.push(`PG degree eligibility: ${pg.eligibility?.reason || "unclear"}`)
      }
      if (!namesMatch(member.name, pgX.full_name)) {
        degreeVerified = false
        notes.push("Name on degree does not match member name")
      }
      if (pgX.extraction_confidence === "low") {
        degreeVerified = false
        notes.push("Low OCR confidence on degree")
      }
      if (yearOfPassing && yearOfPassing > thisYear) {
        degreeVerified = false
        notes.push("Degree year is in the future")
      }
    }
    if (degreeVerified) notes.push(`PG degree verified (${pgX.degree_name || "degree"}${pgX.specialisation ? ", " + pgX.specialisation : ""})`)

    // ---- Verify ASI membership (only when claimed) ------------------------------
    let asiVerified = false
    if (asiFile) {
      const asi = await readExtraction(asiFile, "asi_member_certificate")
      const asiX = asi.extracted || {}
      if (asi.engineError || !asi.isValid) {
        notes.push(asi.engineError ? "ASI certificate could not be read automatically" : "ASI certificate rejected as not valid")
      } else if (normId(asiX.asi_membership_id) !== normId(asiClaimed)) {
        notes.push("ASI number on certificate does not match the number entered")
      } else if (!namesMatch(member.name, asiX.full_name)) {
        notes.push("Name on ASI certificate does not match member name")
      } else if ((asi.expiryWarnings || []).length > 0) {
        notes.push("ASI certificate may be out of date")
      } else {
        asiVerified = true
        notes.push("ASI certificate verified")
      }
    }

    // Target is decided by the server from the evidence the member offered.
    const toType: "LM" | "ALM" = asiClaimed ? "LM" : "ALM"
    const autoApprove = degreeVerified && (toType === "ALM" || asiVerified)

    // ---- Store evidence ----------------------------------------------------------
    const pgPath = await storeFile(supabase, member.id, pgFile, "pg_degree")
    const asiPath = asiFile ? await storeFile(supabase, member.id, asiFile, "asi_certificate") : null
    if (!pgPath) return bad("Could not store your document. Please try again.", 500)

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const upgradeNumber = `UPG-${date}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    const nowIso = new Date().toISOString()

    const { data: upgrade, error: insertError } = await supabase
      .from("membership_upgrades")
      .insert({
        upgrade_number: upgradeNumber,
        member_id: member.id,
        amasi_number: member.amasi_number,
        member_name: member.name,
        member_email: member.email,
        from_type: "ACM",
        to_type: toType,
        asi_membership_no: asiClaimed || null,
        asi_state: asiState,
        asi_certificate_url: asiPath,
        documents: { pg_degree_certificate: pgPath, pg_extracted: pgX },
        ai_verified: autoApprove,
        ai_confidence: autoApprove ? "high" : degreeVerified ? "medium" : "low",
        review_notes: notes.join("; "),
        status: autoApprove ? "approved" : "pending_review",
        reviewed_at: autoApprove ? nowIso : null,
      })
      .select()
      .single()

    if (insertError || !upgrade) {
      Sentry.captureException(insertError, { tags: { route: "members/upgrade/acm", op: "insert" }, extra: { memberId: member.id } })
      return bad("Failed to create upgrade request", 500)
    }

    if (!autoApprove) {
      return Response.json({
        status: true,
        auto_approved: false,
        to_type: toType,
        message: "Your documents have been submitted and are pending review by the AMASI office.",
      })
    }

    // ---- Activate -----------------------------------------------------------------
    const memberUpdate: Record<string, unknown> = {
      membership_type: toType,
      voting_eligible: toType === "LM",
      pg_degree_certificate: pgPath,
      updated_at: nowIso,
    }
    if (pgX.degree_name) memberUpdate.pg_degree = pgX.specialisation ? `${pgX.degree_name} (${pgX.specialisation})` : pgX.degree_name
    if (pgX.university_name) memberUpdate.pg_university = pgX.university_name
    if (yearOfPassing) memberUpdate.pg_year = String(yearOfPassing)
    if (toType === "LM") {
      memberUpdate.asi_membership_no = asiClaimed
      memberUpdate.asi_state = asiState
      if (asiPath) memberUpdate.asi_member_certificate = asiPath
    }

    // Guard on the current type so two concurrent submissions cannot both flip the row.
    const { data: updated, error: updateError } = await supabase
      .from("members")
      .update(memberUpdate)
      .eq("id", member.id)
      .eq("membership_type", member.membership_type)
      .select("id")

    if (updateError || !updated || updated.length === 0) {
      // Do not leave a phantom approval; fall back to the review queue.
      Sentry.captureException(updateError ?? new Error("member update matched no row"), {
        tags: { route: "members/upgrade/acm", op: "member-update" },
        extra: { memberId: member.id, upgradeId: upgrade.id, toType },
      })
      await supabase
        .from("membership_upgrades")
        .update({ status: "pending_review", ai_verified: false, reviewed_at: null, review_notes: `${notes.join("; ")}; auto-activation failed, needs admin` })
        .eq("id", upgrade.id)
        .throwOnError()
      return Response.json({
        status: true,
        auto_approved: false,
        to_type: toType,
        message: "Your documents have been submitted and are pending review by the AMASI office.",
      })
    }

    await logMembershipAuditEvent({
      action: "member_upgrade_auto_approved",
      entityType: "member",
      entityId: member.id,
      oldData: { membership_type: member.membership_type },
      newData: { membership_type: toType, upgrade_id: upgrade.id },
      performedBy: (member.email as string) || null,
    })

    try {
      const key = process.env.RESEND_API_KEY?.trim()
      if (!key) throw new Error("RESEND_API_KEY not configured")
      const label = toType === "LM" ? "Life Member (LM)" : "Associate Life Member (ALM)"
      await new Resend(key).emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: member.email as string,
        subject: `AMASI Membership Upgraded to ${label}`,
        html: `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #1a1a1a;">Membership upgraded</h2>
          <p style="color: #555;">Dear ${escapeHtml(member.name as string)},</p>
          <p style="color: #555;">Your PG degree has been verified. Your AMASI membership (#${escapeHtml(String(member.amasi_number))}) is now <strong>${label}</strong>.</p>
          ${toType === "LM" ? `<p style="color: #555; font-size: 14px;">You are now eligible for voting rights and all Life Member benefits.</p>` : ""}
          <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
        </div>`,
      })
    } catch (emailErr) {
      Sentry.captureException(emailErr, { tags: { route: "members/upgrade/acm", op: "email" } })
    }

    return Response.json({
      status: true,
      auto_approved: true,
      to_type: toType,
      message:
        toType === "LM"
          ? "Your degree and ASI membership are verified. You are now a Life Member."
          : "Your degree is verified. You are now an Associate Life Member.",
    })
  } catch (error) {
    Sentry.captureException(error, { tags: { route: "members/upgrade/acm", op: "unhandled" } })
    return bad("Failed to process upgrade request", 500)
  }
}
