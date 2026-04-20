import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"

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

    // Handle file uploads to Supabase Storage
    const documents = app.documents || {}
    const fileFields = ["photo", "pg_certificate", "mci_certificate"]

    for (const fieldName of fileFields) {
      const file = formData.get(fieldName) as File | null
      if (file && file.size > 0) {
        // Validate file size (5 MB max)
        if (file.size > 5 * 1024 * 1024) {
          return Response.json({ status: false, message: `${fieldName} exceeds 5 MB limit` }, { status: 400 })
        }
        // Validate file type by magic bytes
        const headerBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
        const isJPEG = headerBytes[0] === 0xFF && headerBytes[1] === 0xD8
        const isPNG = headerBytes[0] === 0x89 && headerBytes[1] === 0x50 && headerBytes[2] === 0x4E && headerBytes[3] === 0x47
        const isPDF = headerBytes[0] === 0x25 && headerBytes[1] === 0x50 && headerBytes[2] === 0x44 && headerBytes[3] === 0x46
        if (!isJPEG && !isPNG && !isPDF) {
          return Response.json({ status: false, message: `${fieldName}: only JPG, PNG, and PDF files are accepted` }, { status: 400 })
        }
        const ext = file.name.split(".").pop() || "jpg"
        const path = `applications/${applicationId}/${fieldName}_${Date.now()}.${ext}`

        const { error: uploadError } = await supabase.storage
          .from("uploads")
          .upload(path, file, { upsert: true })

        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(path)
          documents[fieldName] = {
            url: urlData.publicUrl,
            name: file.name,
            status: "uploaded",
            uploaded_at: new Date().toISOString(),
          }
        }
      }
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

    return Response.json({ status: true, message: "Application resubmitted successfully" })
  } catch (error: any) {
    console.error("Resubmit error:", error)
    return Response.json({ status: false, message: "Failed to resubmit application" }, { status: 500 })
  }
}
