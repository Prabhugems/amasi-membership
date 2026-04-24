import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { Resend } from "resend"
import { logAiDecision, type AiDecisionInput } from "@/lib/ai-decision-log"
import { escapeHtml } from "@/lib/html-escape"
import { normalizeDocumentKey, requiresExtraction, CANONICAL_KEYS, EXTRACTION_SKIPPED_KEYS } from "@/lib/document-keys"
import { extractDocument } from "@/lib/document-extraction"

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

    // Rate limit: 10 requests per 15 minutes per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`resubmit:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const data = JSON.parse(dataStr)
    const { applicationId, email: callerEmail, updates: rawUpdates } = data
    const updates = rawUpdates || {}

    if (!applicationId) {
      return Response.json({ status: false, message: "Application ID required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify application exists and is in correct status
    const { data: app, error: fetchError } = await supabase
      .from("membership_applications")
      .select("*")
      .eq("id", applicationId)
      .single()

    if (fetchError || !app) {
      return Response.json({ status: false, message: "Application not found" }, { status: 404 })
    }

    // Verify caller owns this application
    if (!callerEmail || app.email?.toLowerCase() !== callerEmail.toLowerCase()) {
      return Response.json({ status: false, message: "Unauthorized" }, { status: 403 })
    }

    if (!["need_clarification", "resubmit_requested"].includes(app.status)) {
      return Response.json({ status: false, message: "This application cannot be edited" }, { status: 400 })
    }

    // Verify caller has a recently verified OTP for this email
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    const { data: otpCheck } = await supabase
      .from("otp_codes")
      .select("id")
      .eq("email", app.email.toLowerCase())
      .eq("verified", true)
      .gte("created_at", twoHoursAgo)
      .limit(1)
      .maybeSingle()

    if (!otpCheck) {
      return Response.json({ status: false, message: "Please verify your email via OTP before resubmitting" }, { status: 401 })
    }

    // Process all file uploads — accept any canonical or alias key
    const uploadWarnings: string[] = []
    const documents: Record<string, any> = { ...(app.documents || {}) }
    let totalExtractionTime = 0
    let fileCount = 0

    for (const [rawKey, value] of formData.entries()) {
      if (rawKey === "data") continue // skip the JSON data field
      if (!(value instanceof File) || value.size === 0) continue

      const canonicalKey = normalizeDocumentKey(rawKey)
      const file = value as File
      fileCount++

      // Validate file size (5 MB max)
      if (file.size > 5 * 1024 * 1024) {
        return Response.json({ status: false, message: `${rawKey} exceeds 5 MB limit` }, { status: 400 })
      }

      // Validate file type by magic bytes
      const headerBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
      const isJPEG = headerBytes[0] === 0xFF && headerBytes[1] === 0xD8
      const isPNG = headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4E && headerBytes[3] === 0x47
      const isPDF = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && headerBytes[2] === 0x44 && headerBytes[3] === 0x46
      if (!isJPEG && !isPNG && !isPDF) {
        return Response.json({ status: false, message: `${rawKey}: only JPG, PNG, and PDF files are accepted` }, { status: 400 })
      }

      const buffer = Buffer.from(await file.arrayBuffer())
      const ext = isPDF ? "pdf" : isPNG ? "png" : "jpg"

      // Run extraction if this doc type requires it
      if (requiresExtraction(canonicalKey)) {
        const extractionResult = await extractDocument({
          buffer,
          fileName: file.name,
          docType: canonicalKey,
        })
        totalExtractionTime += extractionResult.extractionDurationMs

        // Upload to storage using the CORRECT path format (same as OCR route)
        const storagePath = `${canonicalKey}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        let fileUrl: string | null = null
        try {
          const { error: uploadError } = await supabase.storage
            .from("uploads")
            .upload(storagePath, buffer, {
              contentType: file.type || (isPDF ? "application/pdf" : isPNG ? "image/png" : "image/jpeg"),
              upsert: true,
            })
          if (!uploadError) {
            const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(storagePath)
            fileUrl = urlData?.publicUrl || null
          } else {
            console.error(`File upload failed for ${canonicalKey}:`, uploadError.message)
            uploadWarnings.push(`${canonicalKey} upload failed — please try again`)
          }
        } catch (err: any) {
          console.error(`Storage error for ${canonicalKey}:`, err.message)
          uploadWarnings.push(`${canonicalKey} upload failed`)
        }

        if (extractionResult.isValid) {
          documents[canonicalKey] = {
            status: "extracted",
            fileUrl,
            extracted: extractionResult.extracted,
            message: `Extracted via ${extractionResult.engine}`,
          }
        } else {
          documents[canonicalKey] = {
            status: "uploaded",
            fileUrl,
            extracted: {},
            message: extractionResult.rejectionReason || "Extraction failed",
          }
        }
      } else {
        // Photo/profile — upload to storage only, no extraction
        const storagePath = `photo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        let fileUrl: string | null = null
        try {
          const { error: uploadError } = await supabase.storage
            .from("uploads")
            .upload(storagePath, buffer, { contentType: file.type || "image/jpeg", upsert: true })
          if (!uploadError) {
            const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(storagePath)
            fileUrl = urlData?.publicUrl || null
          }
        } catch {}

        documents[canonicalKey] = {
          status: "uploaded",
          fileUrl,
          extracted: {},
        }
      }
    }

    if (totalExtractionTime > 20000) {
      console.warn(`[resubmit] Document extraction took ${totalExtractionTime}ms for ${fileCount} files — consider async processing`)
    }

    // Build update object — only include fields that are provided
    const updateFields: Record<string, any> = {
      status: "submitted",
      review_notes: null,
      updated_at: new Date().toISOString(),
      documents,
    }

    // Map form fields to DB columns
    const fieldMap: Record<string, string> = {
      salutation: "salutation",
      firstName: "first_name",
      middleName: "middle_name",
      lastName: "last_name",
      fatherName: "father_name",
      dateOfBirth: "date_of_birth",
      gender: "gender",
      addressLine1: "street_address_1",
      addressLine2: "street_address_2",
      city: "city",
      state: "state",
      pinCode: "postal_code",
      country: "country",
      pgDegree: "pg_degree",
      pgCollege: "pg_college",
      pgUniversity: "pg_university",
      pgYear: "pg_year",
      ugCollege: "ug_college",
      mciNumber: "mci_council_number",
      mciState: "mci_council_state",
      asiNumber: "asi_membership_no",
    }

    for (const [formKey, dbKey] of Object.entries(fieldMap)) {
      if (updates[formKey] !== undefined) {
        updateFields[dbKey] = updates[formKey] || null
      }
    }

    // Also update the full name
    const nameParts = [updates.salutation, updates.firstName, updates.middleName, updates.lastName].filter(Boolean)
    if (nameParts.length > 0) {
      updateFields.name = nameParts.join(" ")
    }

    // Update the application
    const { error: updateError } = await supabase
      .from("membership_applications")
      .update(updateFields)
      .eq("id", applicationId)

    if (updateError) {
      console.error("Resubmit update error:", updateError)
      return Response.json({ status: false, message: "Failed to update application" }, { status: 500 })
    }

    // Re-run AI scoring on resubmitted application
    try {
      const { scoreApplication, toScorerFormShape } = await import("@/lib/ai-approval")
      const updatedApp = { ...app, ...updateFields }
      const scoringStart = performance.now()
      const approval = await scoreApplication(toScorerFormShape(updatedApp), updatedApp.documents || {}, true, supabase)
      const scoringDurationMs = Math.round(performance.now() - scoringStart)
      const aiConfidence = `${approval.totalScore}% — ${approval.totalScore >= 80 ? "high" : approval.totalScore >= 50 ? "medium" : "low"}`
      await supabase.from("membership_applications").update({
        ai_confidence: aiConfidence,
        ai_verified: approval.autoApprove,
        needs_manual_review: !approval.autoApprove,
        ai_flags: [...approval.flags, ...approval.checks.map(c => `${c.check}: ${c.score}% ${c.passed ? "\u2713" : "\u2717"} — ${c.detail}`)],
      }).eq("id", applicationId)

      await logAiDecision(supabase, {
        applicationId,
        applicationReference: app.reference_number,
        membershipType: app.membership_type,
        formData: updatedApp,
        uploads: updatedApp.documents || {},
        paymentPaid: true,
      }, approval, scoringDurationMs, null).catch(err => console.error("[resubmit] ai decision log failed:", err))
    } catch (aiErr) {
      console.error("AI re-scoring error:", aiErr)
    }

    // Send confirmation email
    try {
      const resend = getResend()
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: app.email,
        subject: `AMASI Application Resubmitted — ${app.reference_number}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #1a1a1a;">Application Resubmitted</h2>
            <p style="color: #555;">Dear ${escapeHtml(app.salutation || "Dr.")} ${escapeHtml(updates.firstName || app.first_name || app.name)},</p>
            <p style="color: #555;">Your AMASI membership application has been successfully resubmitted and is now under review.</p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: #166534; font-weight: bold; margin: 0;">Reference: ${app.reference_number}</p>
              <p style="color: #166534; font-size: 14px; margin: 4px 0 0;">Status: Under Review</p>
            </div>
            <p style="color: #555; font-size: 14px;">You will be notified once your application is reviewed.</p>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Resubmit email error:", emailErr)
    }

    return Response.json({ status: true, message: "Application resubmitted successfully", warnings: uploadWarnings })
  } catch (error: any) {
    console.error("Resubmit error:", error)
    return Response.json({ status: false, message: "Failed to resubmit application" }, { status: 500 })
  }
}
