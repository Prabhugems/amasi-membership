import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { checkRateLimit } from "@/lib/rate-limit"
import { normalizeDocumentKey, requiresExtraction } from "@/lib/document-keys"
import { extractDocument } from "@/lib/document-extraction"
import { recordStepEvent } from "@/lib/funnel-tracking"

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`ocr:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ success: false, error: "Too many requests. Try again later." }, { status: 429 })
    }

    // Verify caller has a valid member session
    const { getMemberSession } = await import("@/lib/auth")
    const session = await getMemberSession()
    if (!session) {
      return Response.json({ success: false, error: "Please verify your email first" }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const rawDocType = formData.get("docType") as string

    if (!file || !rawDocType) {
      return Response.json({ success: false, error: "Missing file or docType" }, { status: 400 })
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({ success: false, error: "File too large. Maximum 5 MB." }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Validate magic bytes — only accept JPEG, PNG, PDF
    const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8
    const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
    const isPDF = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
    if (!isJPEG && !isPNG && !isPDF) {
      return Response.json({ success: false, error: "Invalid file format. Only JPG, PNG, and PDF are accepted." }, { status: 400 })
    }

    const docType = normalizeDocumentKey(rawDocType)

    // Profile photos don't need OCR — just upload to storage
    if (!requiresExtraction(docType)) {
      let fileUrl = null
      try {
        const { createAdminClient } = await import("@/lib/supabase")
        const supabase = createAdminClient()
        const ext = isPDF ? "pdf" : isPNG ? "png" : "jpg"
        const fileName = `photo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
        const { error: uploadError } = await supabase.storage.from("uploads").upload(fileName, buffer, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        })
        if (!uploadError) {
          const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(fileName)
          fileUrl = urlData?.publicUrl || null
        }
      } catch {}
      void recordStepEvent({
        email: (session.email as string) || "",
        eventType: "doc_upload",
        step: 3,
        status: "uploaded",
        metadata: { docType, bytes: buffer.length, ocr_skipped: true },
      })
      return Response.json({ success: true, extracted: {}, docType, fileUrl })
    }

    // Run extraction via shared library
    const result = await extractDocument({ buffer, fileName: file.name, docType })

    // Handle invalid document (same response shape as before)
    if (!result.isValid) {
      void recordStepEvent({
        email: (session.email as string) || "",
        eventType: "doc_upload",
        step: 3,
        status: "rejected",
        metadata: { docType, reason: result.rejectionReason || "invalid", engine: result.engine },
      })
      return Response.json({
        success: false,
        isIrrelevant: true,
        extracted: result.extracted,
        message: result.rejectionReason || "This doesn't appear to be a valid medical document. Please upload the correct certificate.",
      })
    }

    // Upload file to Supabase Storage for admin review
    let fileUrl: string | null = null
    try {
      const { createAdminClient } = await import("@/lib/supabase")
      const supabase = createAdminClient()
      const ext = isPDF ? "pdf" : isPNG ? "png" : "jpg"
      const fileName = `${docType}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(fileName, buffer, {
          contentType: file.type || (isPDF ? "application/pdf" : isPNG ? "image/png" : "image/jpeg"),
          upsert: false,
        })

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(fileName)
        fileUrl = urlData?.publicUrl || null
      } else {
        console.error("Document upload error:", uploadError.message)
      }
    } catch (uploadErr: any) {
      // Non-blocking — OCR result still returned even if storage fails
      console.error("Document storage error:", uploadErr.message)
    }

    void recordStepEvent({
      email: (session.email as string) || "",
      eventType: "doc_upload",
      step: 3,
      status: "extracted",
      metadata: {
        docType,
        engine: result.engine,
        fields_extracted: Object.keys(result.extracted || {}).length,
        eligibility: result.eligibility?.eligible ?? null,
        eligibility_reason: result.eligibility?.reason ?? null,
        has_warnings: (result.expiryWarnings || []).length > 0,
      },
    })

    return Response.json({
      success: true,
      extracted: result.extracted,
      eligibility: result.eligibility,
      expiryWarnings: result.expiryWarnings.length > 0 ? result.expiryWarnings : undefined,
      docType,
      engine: result.engine,
      fileUrl,
    })
  } catch (error: any) {
    console.error("OCR API error:", error)
    Sentry.captureException(error, { tags: { flow: "ocr_upload" } })
    return Response.json({ success: false, error: "Could not process this document. Please try a clearer image." }, { status: 500 })
  }
}
