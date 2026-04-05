import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { extractTextFromImage } from "@/lib/ocr"
import { Resend } from "resend"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const dataStr = formData.get("data") as string

    if (!dataStr) {
      return Response.json({ status: false, message: "No data provided" }, { status: 400 })
    }

    const data = JSON.parse(dataStr)
    const { memberId, amasiNumber, memberName, memberEmail, asiMembershipNo, asiState } = data

    if (!memberId || !amasiNumber || !memberEmail || !asiMembershipNo) {
      return Response.json({ status: false, message: "Missing required fields" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify member exists and is ALM (try by id first, then by amasi_number)
    let member = null
    let memberError = null

    const { data: m1, error: e1 } = await supabase
      .from("members")
      .select("id, membership_type, amasi_number, name, email")
      .eq("id", memberId)
      .single()

    if (m1) {
      member = m1
    } else {
      // Fallback: try by amasi_number
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

    const memberType = (member.membership_type || "").toUpperCase()
    if (!memberType.includes("ALM") && !memberType.includes("ASSOCIATE")) {
      return Response.json({ status: false, message: "Only ALM members can upgrade to LM" }, { status: 400 })
    }

    // Check for existing pending/approved upgrade
    const { data: existing } = await supabase
      .from("membership_upgrades")
      .select("id, status")
      .eq("member_id", memberId)
      .in("status", ["pending", "pending_review", "approved"])
      .limit(1)

    if (existing && existing.length > 0) {
      const s = existing[0].status
      if (s === "approved") {
        return Response.json({ status: false, message: "Your upgrade has already been approved" }, { status: 400 })
      }
      return Response.json({ status: false, message: "You already have a pending upgrade request" }, { status: 400 })
    }

    // Upload files to Supabase Storage
    let asiCertificateUrl: string | null = null
    let asiEmailProofUrl: string | null = null

    const asiCertFile = formData.get("asi_certificate") as File | null
    if (asiCertFile && asiCertFile.size > 0) {
      const ext = asiCertFile.name.split(".").pop() || "pdf"
      const path = `upgrades/${memberId}/asi_certificate_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(path, asiCertFile, { upsert: true })
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path)
        asiCertificateUrl = urlData.publicUrl
      }
    }

    const asiEmailFile = formData.get("asi_email_proof") as File | null
    if (asiEmailFile && asiEmailFile.size > 0) {
      const ext = asiEmailFile.name.split(".").pop() || "pdf"
      const path = `upgrades/${memberId}/asi_email_proof_${Date.now()}.${ext}`
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(path, asiEmailFile, { upsert: true })
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path)
        asiEmailProofUrl = urlData.publicUrl
      }
    }

    // AI verification with OCR
    let aiVerified = false
    let aiConfidence: "high" | "medium" | "low" = "low"
    let aiNotes: string[] = []

    const asiNumTrimmed = asiMembershipNo.trim()
    const asiFormatValid = asiNumTrimmed.length >= 2 && asiNumTrimmed.length <= 20
    const hasCertificate = !!asiCertificateUrl

    // Run OCR on the ASI certificate if uploaded
    let ocrText = ""
    if (asiCertFile && asiCertFile.size > 0) {
      try {
        const buffer = Buffer.from(await asiCertFile.arrayBuffer())
        const ocrResult = await extractTextFromImage(buffer, asiCertFile.name)
        if (ocrResult.success) {
          ocrText = ocrResult.text.toLowerCase()
        }
      } catch (e) {
        console.error("OCR error:", e)
      }
    }

    // Scoring: 4 checks
    let score = 0
    const maxScore = 4

    // Check 1: ASI number format valid
    if (asiFormatValid) {
      score++
      aiNotes.push("ASI number format valid")
    } else {
      aiNotes.push("ASI number format invalid")
    }

    // Check 2: Certificate uploaded
    if (hasCertificate) {
      score++
      aiNotes.push("Certificate uploaded")
    } else {
      aiNotes.push("No certificate uploaded")
    }

    // Check 3: ASI number found in certificate OCR text
    if (ocrText) {
      const asiNumClean = asiNumTrimmed.replace(/[^a-zA-Z0-9]/g, "").toLowerCase()
      const asiNumDigits = asiNumTrimmed.replace(/\D/g, "")
      if (ocrText.includes(asiNumClean) || (asiNumDigits.length >= 3 && ocrText.includes(asiNumDigits))) {
        score++
        aiNotes.push("ASI number found in certificate")
      } else {
        aiNotes.push("ASI number NOT found in certificate text")
      }

      // Check 4: Member name found in certificate
      const memberNameLower = (memberName || member.name || "").toLowerCase()
      const nameParts = memberNameLower.split(/\s+/).filter((p: string) => p.length > 2)
      const nameMatches = nameParts.filter((p: string) => ocrText.includes(p)).length
      if (nameMatches >= 2 || (nameParts.length === 1 && nameMatches === 1)) {
        score++
        aiNotes.push("Member name found in certificate")
      } else {
        aiNotes.push("Member name NOT found in certificate text")
      }

      // Check if it's actually an ASI document
      const asiKeywords = ["association of surgeons", "asi", "surgeon", "membership"]
      const hasAsiKeyword = asiKeywords.some(k => ocrText.includes(k))
      if (!hasAsiKeyword) {
        score = Math.max(0, score - 1)
        aiNotes.push("Document may not be an ASI certificate")
      }
    } else if (hasCertificate) {
      aiNotes.push("OCR could not read certificate — manual review needed")
    }

    // Determine confidence
    if (score >= 3) {
      aiVerified = true
      aiConfidence = "high"
    } else if (score >= 2) {
      aiVerified = false
      aiConfidence = "medium"
    } else {
      aiVerified = false
      aiConfidence = "low"
    }

    // Insert upgrade record
    const upgradeRecord = {
      member_id: memberId,
      amasi_number: amasiNumber,
      member_name: memberName || member.name,
      member_email: memberEmail || member.email,
      from_type: "ALM",
      to_type: "LM",
      asi_membership_no: asiNumTrimmed,
      asi_state: asiState || null,
      asi_certificate_url: asiCertificateUrl,
      asi_email_proof_url: asiEmailProofUrl,
      ai_verified: aiVerified,
      ai_confidence: aiConfidence,
      review_notes: aiNotes.join("; "),
      status: "pending",
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

    // Auto-approve if AI verified with high confidence
    if (aiVerified && aiConfidence === "high") {
      // Update member to LM
      const { error: memberUpdateError } = await supabase
        .from("members")
        .update({
          membership_type: "LM",
          asi_membership_no: asiNumTrimmed,
          asi_state: asiState || null,
          voting_eligible: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", memberId)

      if (!memberUpdateError) {
        // Update upgrade record to approved
        await supabase
          .from("membership_upgrades")
          .update({
            status: "approved",
            reviewed_at: new Date().toISOString(),
            review_notes: "Auto-approved by AI verification (high confidence)",
          })
          .eq("id", upgrade.id)

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
                <p style="color: #555;">Dear ${memberName || member.name},</p>
                <p style="color: #555;">Your AMASI membership has been upgraded from <strong>Associate Life Member (ALM)</strong> to <strong>Life Member (LM)</strong>.</p>
                <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                  <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Membership Status</p>
                  <p style="font-size: 24px; font-weight: bold; color: #0f766e; margin: 0;">Life Member (LM)</p>
                  <p style="color: #666; font-size: 13px; margin: 8px 0 0;">AMASI #${amasiNumber}</p>
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
        await supabase
          .from("membership_upgrades")
          .update({ status: "pending_review" })
          .eq("id", upgrade.id)
      }
    } else {
      // Set to pending_review for admin
      await supabase
        .from("membership_upgrades")
        .update({ status: "pending_review" })
        .eq("id", upgrade.id)
    }

    return Response.json({
      status: true,
      upgrade: { ...upgrade, status: autoApproved ? "approved" : "pending_review" },
      auto_approved: autoApproved,
      message: autoApproved
        ? "Your membership has been upgraded to Life Member!"
        : "Your upgrade request has been submitted and is pending admin review.",
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

    let query = supabase
      .from("membership_upgrades")
      .select("*")
      .order("created_at", { ascending: false })

    if (all === "1") {
      const adminSession = await getAdminSession()
      if (!adminSession) {
        return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
      }
    } else if (email) {
      query = query.eq("member_email", email)
    } else {
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
