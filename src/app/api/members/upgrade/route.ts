import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { verifyMemberOwnership } from "@/lib/member-ownership"
import { checkRateLimit } from "@/lib/rate-limit"
import { extractTextFromImage } from "@/lib/ocr"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    const adminSession = await getAdminSession()
    const memberSession = adminSession ? null : await getMemberSession()
    if (!adminSession && !memberSession) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const formData = await request.formData()
    const dataStr = formData.get("data") as string

    if (!dataStr) {
      return Response.json({ status: false, message: "No data provided" }, { status: 400 })
    }

    const data = JSON.parse(dataStr)
    const { memberId, amasiNumber, memberName, memberEmail, asiMembershipNo, asiState } = data

    if (!memberId || !amasiNumber || !memberEmail) {
      return Response.json({ status: false, message: "Missing required fields" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // If a member is submitting, ensure they own this memberId
    if (!adminSession && memberSession?.email) {
      const owns = await verifyMemberOwnership(supabase, memberSession.email as string, memberId)
      if (!owns) {
        return Response.json({ error: "Forbidden" }, { status: 403 })
      }
    }

    // Resolve the member (try by id first, then by amasi_number)
    let member = null
    let memberError = null

    const { data: m1 } = await supabase
      .from("members")
      .select("id, membership_type, amasi_number, name, email")
      .eq("id", memberId)
      .single()

    if (m1) {
      member = m1
    } else {
      const { data: m2, error: e2 } = await supabase
        .from("members")
        .select("id, membership_type, amasi_number, name, email")
        .eq("amasi_number", parseInt(amasiNumber))
        .single()
      member = m2
      memberError = e2
    }

    if (memberError || !member) {
      return Response.json({ status: false, message: "Member not found" }, { status: 404 })
    }

    // Determine the upgrade ladder from the member's CURRENT type — never
    // trust the client. ACM (candidate, pursuing PG) -> ALM by submitting a
    // completed PG degree (no ASI number). ALM -> LM by submitting an ASI
    // membership certificate. LM/ILM are already life members and cannot
    // upgrade here.
    const rawType = (member.membership_type || "").toUpperCase()
    let kind: "ACM_TO_ALM" | "ALM_TO_LM"
    if (rawType.includes("ACM") || rawType.includes("CANDIDATE")) {
      kind = "ACM_TO_ALM"
    } else if (rawType.includes("ALM") || (rawType.includes("ASSOCIATE") && rawType.includes("LIFE"))) {
      kind = "ALM_TO_LM"
    } else {
      return Response.json({ status: false, message: "Only ACM and ALM members can upgrade" }, { status: 400 })
    }
    const fromType = kind === "ACM_TO_ALM" ? "ACM" : "ALM"
    const toType = kind === "ACM_TO_ALM" ? "ALM" : "LM"

    const asiNumTrimmed = (asiMembershipNo || "").trim()
    const pgDegreeFile = formData.get("pg_degree") as File | null
    const asiCertFile = formData.get("asi_certificate") as File | null

    // Per-kind required inputs
    if (kind === "ALM_TO_LM") {
      if (!asiNumTrimmed) {
        return Response.json({ status: false, message: "ASI Membership Number is required" }, { status: 400 })
      }
      if (!(asiCertFile && asiCertFile.size > 0)) {
        return Response.json({ status: false, message: "ASI certificate is required" }, { status: 400 })
      }
    } else {
      if (!(pgDegreeFile && pgDegreeFile.size > 0)) {
        return Response.json({ status: false, message: "PG degree certificate is required" }, { status: 400 })
      }
    }

    // Check for existing pending/approved upgrade
    const { data: existing } = await supabase
      .from("membership_upgrades")
      .select("id, status")
      .eq("member_id", member.id)
      .in("status", ["pending", "pending_review", "approved"])
      .limit(1)

    if (existing && existing.length > 0) {
      const s = existing[0].status
      if (s === "approved") {
        return Response.json({ status: false, message: "This member's upgrade has already been approved" }, { status: 400 })
      }
      return Response.json({ status: false, message: "There is already a pending upgrade request for this member" }, { status: 400 })
    }

    // ---- file validation + upload helpers ----
    // Validate file (5 MB max, magic bytes for JPG/PNG/PDF)
    const validateFile = async (file: File, label: string) => {
      if (file.size > 5 * 1024 * 1024) {
        return `${label} exceeds 5 MB limit`
      }
      const hdr = new Uint8Array(await file.slice(0, 8).arrayBuffer())
      const ok = (hdr[0] === 0xFF && hdr[1] === 0xD8) || // JPEG
        (hdr[0] === 0x89 && hdr[1] === 0x50 && hdr[2] === 0x4E && hdr[3] === 0x47) || // PNG
        (hdr[0] === 0x25 && hdr[1] === 0x50 && hdr[2] === 0x44 && hdr[3] === 0x46) // PDF
      return ok ? null : `${label}: only JPG, PNG, and PDF files are accepted`
    }
    const uploadFile = async (file: File, name: string) => {
      const ext = file.name.split(".").pop() || "pdf"
      const path = `upgrades/${member.id}/${name}_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(path, file, { upsert: true })
      if (uploadError) return null
      const { data: urlData } = await supabase.storage.from("uploads").createSignedUrl(path, 60 * 60 * 24 * 365)
      return urlData?.signedUrl || null
    }

    let asiCertificateUrl: string | null = null
    let asiEmailProofUrl: string | null = null
    let pgDegreeUrl: string | null = null

    if (kind === "ALM_TO_LM") {
      if (asiCertFile && asiCertFile.size > 0) {
        const err = await validateFile(asiCertFile, "ASI certificate")
        if (err) return Response.json({ status: false, message: err }, { status: 400 })
        asiCertificateUrl = await uploadFile(asiCertFile, "asi_certificate")
      }
      const asiEmailFile = formData.get("asi_email_proof") as File | null
      if (asiEmailFile && asiEmailFile.size > 0) {
        const err = await validateFile(asiEmailFile, "ASI email proof")
        if (err) return Response.json({ status: false, message: err }, { status: 400 })
        asiEmailProofUrl = await uploadFile(asiEmailFile, "asi_email_proof")
      }
    } else {
      if (pgDegreeFile && pgDegreeFile.size > 0) {
        const err = await validateFile(pgDegreeFile, "PG degree certificate")
        if (err) return Response.json({ status: false, message: err }, { status: 400 })
        pgDegreeUrl = await uploadFile(pgDegreeFile, "pg_degree")
      }
    }

    // ---- AI / OCR assist ----
    let aiVerified = false
    let aiConfidence: "high" | "medium" | "low" = "low"
    const aiNotes: string[] = []
    // Auto-approval is enabled ONLY for ALM->LM, where the ASI number can be
    // cross-checked against the certificate text. ACM->ALM always routes to
    // admin review — PG degree layouts vary too much to auto-trust.
    let allowAutoApprove = false

    if (kind === "ALM_TO_LM") {
      allowAutoApprove = true
      const asiFormatValid = asiNumTrimmed.length >= 2 && asiNumTrimmed.length <= 20
      const hasCertificate = !!asiCertificateUrl

      let ocrText = ""
      if (asiCertFile && asiCertFile.size > 0) {
        try {
          const buffer = Buffer.from(await asiCertFile.arrayBuffer())
          const ocrResult = await extractTextFromImage(buffer, asiCertFile.name)
          if (ocrResult.success) ocrText = ocrResult.text.toLowerCase()
        } catch (e) {
          console.error("OCR error:", e)
        }
      }

      let score = 0
      if (asiFormatValid) { score++; aiNotes.push("ASI number format valid") } else { aiNotes.push("ASI number format invalid") }
      if (hasCertificate) { score++; aiNotes.push("Certificate uploaded") } else { aiNotes.push("No certificate uploaded") }
      if (ocrText) {
        const asiNumClean = asiNumTrimmed.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
        const asiNumDigits = asiNumTrimmed.replace(/\D/g, "")
        if (ocrText.includes(asiNumClean) || (asiNumDigits.length >= 3 && ocrText.includes(asiNumDigits))) {
          score++; aiNotes.push("ASI number found in certificate")
        } else {
          aiNotes.push("ASI number NOT found in certificate text")
        }
        const memberNameLower = (memberName || member.name || "").toLowerCase()
        const nameParts = memberNameLower.split(/\s+/).filter((p: string) => p.length > 2)
        const nameMatches = nameParts.filter((p: string) => ocrText.includes(p)).length
        if (nameMatches >= 2 || (nameParts.length === 1 && nameMatches === 1)) {
          score++; aiNotes.push("Member name found in certificate")
        } else {
          aiNotes.push("Member name NOT found in certificate text")
        }
        const asiKeywords = ["association of surgeons", "asi", "surgeon", "membership"]
        if (!asiKeywords.some(k => ocrText.includes(k))) {
          score = Math.max(0, score - 1)
          aiNotes.push("Document may not be an ASI certificate")
        }
      } else if (hasCertificate) {
        aiNotes.push("OCR could not read certificate — manual review needed")
      }

      if (score >= 3) { aiVerified = true; aiConfidence = "high" }
      else if (score >= 2) { aiConfidence = "medium" }
      else { aiConfidence = "low" }
    } else {
      // ACM -> ALM: surface helpful notes from the PG degree for the admin,
      // but never auto-approve.
      aiNotes.push("PG degree certificate uploaded")
      let ocrText = ""
      if (pgDegreeFile && pgDegreeFile.size > 0) {
        try {
          const buffer = Buffer.from(await pgDegreeFile.arrayBuffer())
          const ocrResult = await extractTextFromImage(buffer, pgDegreeFile.name)
          if (ocrResult.success) ocrText = ocrResult.text.toLowerCase()
        } catch (e) {
          console.error("OCR error:", e)
        }
      }
      if (ocrText) {
        const memberNameLower = (memberName || member.name || "").toLowerCase()
        const nameParts = memberNameLower.split(/\s+/).filter((p: string) => p.length > 2)
        const nameMatches = nameParts.filter((p: string) => ocrText.includes(p)).length
        if (nameMatches >= 2 || (nameParts.length === 1 && nameMatches === 1)) {
          aiNotes.push("Member name found on degree")
        } else {
          aiNotes.push("Member name NOT found on degree — verify manually")
        }
        const degreeKeywords = ["master of surgery", "m.s", "m.ch", "mch", "m.d", "dnb", "diplomate", "doctor of medicine", "fellowship", "post graduate", "postgraduate"]
        if (degreeKeywords.some(k => ocrText.includes(k))) {
          aiNotes.push("Postgraduate degree keywords found")
        } else {
          aiNotes.push("No clear PG degree keywords found — verify manually")
        }
      } else {
        aiNotes.push("OCR could not read the degree — manual review needed")
      }
      aiConfidence = "medium"
    }

    // Generate upgrade number
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const code = Math.random().toString(36).substring(2, 6).toUpperCase()
    const upgradeNumber = `UPG-${date}-${code}`

    // Insert upgrade record
    const upgradeRecord = {
      upgrade_number: upgradeNumber,
      member_id: member.id,
      amasi_number: amasiNumber,
      member_name: memberName || member.name,
      member_email: memberEmail || member.email,
      from_type: fromType,
      to_type: toType,
      asi_membership_no: kind === "ALM_TO_LM" ? asiNumTrimmed : null,
      asi_state: kind === "ALM_TO_LM" ? (asiState || null) : null,
      asi_certificate_url: asiCertificateUrl,
      asi_email_proof_url: asiEmailProofUrl,
      documents: pgDegreeUrl ? { pg_degree_url: pgDegreeUrl } : null,
      ai_verified: aiVerified,
      ai_confidence: aiConfidence,
      review_notes: aiNotes.join("; "),
      status: "pending_review",
    }

    const { data: upgrade, error: insertError } = await supabase
      .from("membership_upgrades")
      .insert(upgradeRecord)
      .select()
      .single()

    if (insertError) {
      console.error("Upgrade insert error:", insertError)
      return Response.json({ status: false, message: "Failed to create upgrade request" }, { status: 500 })
    }

    let autoApproved = false

    // Auto-approve only ALM->LM with high AI confidence
    if (allowAutoApprove && aiVerified && aiConfidence === "high") {
      const { error: memberUpdateError } = await supabase
        .from("members")
        .update({
          membership_type: "LM",
          asi_membership_no: asiNumTrimmed,
          asi_state: asiState || null,
          voting_eligible: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", member.id)

      if (!memberUpdateError) {
        const { error: autoApproveError } = await supabase
          .from("membership_upgrades")
          .update({
            status: "approved",
            reviewed_at: new Date().toISOString(),
            review_notes: "Auto-approved by AI verification (high confidence)",
          })
          .eq("id", upgrade.id)

        if (autoApproveError) {
          console.error("Failed to mark upgrade as auto-approved:", autoApproveError)
          return Response.json({ status: false, message: "Failed to update upgrade status" }, { status: 500 })
        }

        autoApproved = true

        // Send approval email
        try {
          const resend = getResend()
          await resend.emails.send({
            from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
            to: memberEmail || member.email,
            subject: `AMASI Membership Upgraded to Life Member`,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
                <div style="text-align: center; margin-bottom: 24px;">
                  <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
                  <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
                </div>
                <h2 style="color: #1a1a1a;">Membership Upgraded!</h2>
                <p style="color: #555;">Dear ${escapeHtml(memberName || member.name)},</p>
                <p style="color: #555;">Your AMASI membership has been upgraded from <strong>Associate Life Member (ALM)</strong> to <strong>Life Member (LM)</strong>.</p>
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                  <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Membership Status</p>
                  <p style="font-size: 24px; font-weight: bold; color: #0f766e; margin: 0;">Life Member (LM)</p>
                  <p style="color: #666; font-size: 13px; margin: 8px 0 0;">AMASI #${escapeHtml(String(amasiNumber))}</p>
                </div>
                <p style="color: #555; font-size: 14px;">You are now eligible for voting rights and all Life Member benefits.</p>
                <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
                <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
              </div>
            `,
          })
        } catch (emailErr) {
          console.error("Upgrade approval email error:", emailErr)
        }
      } else {
        console.error("Failed to update member for auto-approve:", memberUpdateError)
        // Still mark as pending_review if member update failed
        const { error: fallbackError } = await supabase
          .from("membership_upgrades")
          .update({ status: "pending_review" })
          .eq("id", upgrade.id)
        if (fallbackError) {
          console.error("Failed to reset upgrade status to pending_review:", fallbackError)
          const Sentry = await import("@sentry/nextjs")
          Sentry.captureException(fallbackError, {
            tags: { route: "members/upgrade", op: "upgrade-status-fallback" },
            extra: { upgradeId: upgrade.id },
          })
          return Response.json({ status: false, message: "Failed to update upgrade status" }, { status: 500 })
        }
      }
    } else {
      // Set to pending_review for admin
      const { error: pendingError } = await supabase
        .from("membership_upgrades")
        .update({ status: "pending_review" })
        .eq("id", upgrade.id)
      if (pendingError) {
        console.error("Failed to set upgrade status to pending_review:", pendingError)
        const Sentry = await import("@sentry/nextjs")
        Sentry.captureException(pendingError, {
          tags: { route: "members/upgrade", op: "upgrade-status-pending" },
          extra: { upgradeId: upgrade.id },
        })
        return Response.json({ status: false, message: "Failed to update upgrade status" }, { status: 500 })
      }
    }

    return Response.json({
      status: true,
      upgrade: { ...upgrade, status: autoApproved ? "approved" : "pending_review" },
      auto_approved: autoApproved,
      message: autoApproved
        ? "Membership has been upgraded to Life Member!"
        : "The upgrade request has been submitted and is pending admin review.",
    })
  } catch (error: any) {
    console.error("Upgrade error:", error)
    return Response.json({ status: false, message: error.message || "Failed to process upgrade request" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get("email")
    const all = searchParams.get("all")

    const supabase = createAdminClient()

    const isAdmin = all === "1"

    if (isAdmin) {
      const adminSession = await getAdminSession()
      if (!adminSession) {
        return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
      }
    } else {
      // Rate limit non-admin lookups
      const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
      const rl = await checkRateLimit(`upgrade-lookup:${ip}`, 10, 15 * 60 * 1000)
      if (!rl.allowed) {
        return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
      }
    }

    // Members see only safe columns; admins see everything
    const selectCols = isAdmin
      ? "*"
      : "id, upgrade_number, member_id, amasi_number, member_name, member_email, from_type, to_type, asi_membership_no, asi_state, ai_verified, ai_confidence, status, created_at, updated_at"

    let query = supabase
      .from("membership_upgrades")
      .select(selectCols)
      .order("created_at", { ascending: false })

    if (!isAdmin && email) {
      query = query.eq("member_email", email)
    } else if (!isAdmin) {
      return Response.json({ status: false, message: "Email or all=1 parameter required" }, { status: 400 })
    }

    const { data, error } = await query

    if (error) {
      console.error("Upgrade list error:", error)
      return Response.json({ status: false, message: "Failed to fetch upgrades" }, { status: 500 })
    }

    return Response.json({ status: true, data: data || [] })
  } catch (error: any) {
    console.error("Upgrade GET error:", error)
    return Response.json({ status: false, message: error.message }, { status: 500 })
  }
}
