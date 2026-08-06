import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { checkRateLimit } from "@/lib/rate-limit"
import {
  normalizeDocumentKey,
  requiresExtraction,
  manualReviewReasonForExtractionFailure,
} from "@/lib/document-keys"
import { extractDocument } from "@/lib/document-extraction"
import { recordStepEvent } from "@/lib/funnel-tracking"
import { persistOcrUploadToDraft } from "@/lib/persist-ocr-upload"

// Vercel Pro defaults to 15s, but Claude vision on a multi-page certificate
// can take 20–40s, plus the OCR.space fallback. Without this the function is
// killed mid-Claude-call and the browser sees TypeError from fetch (no HTTP
// response), surfacing to the user as "Connection problem" with no Sentry
// signal. See screenshots 2026-05-18 — all three doc uploads failed the same
// way for a member because their MCI cert pushed past the 15s default.
export const maxDuration = 60

// PR 0 contract:
//
//   The route ALWAYS attempts to durably store the file before evaluating
//   AI outcome, except when input validation fails (size/format/auth/rate-
//   limit). When the file is durably stored, the response carries fileUrl
//   and one of:
//
//     outcome: "extracted"                                  - AI happy path
//     outcome: "stored"                                     - profile photo, no extraction
//     outcome: "manual_review_required" + reason: "ocr_below_threshold"
//                                                           - AI judged the doc invalid
//     outcome: "manual_review_required" + reason: "ocr_service_error"
//                                                           - extractDocument threw
//
//   Hard rejections (no fileUrl, no manual review possible):
//
//     outcome: "rejected" + reason: "rate_limit" | "auth" | "missing_input"
//                                  | "file_too_large" | "invalid_format"
//                                  | "ocr_service_error"  (storage failed)
//
//   Legacy fields (success, isIrrelevant, error, extracted, message) are
//   preserved on every branch so the pre-PR-1 frontend keeps behaving the
//   way it does today. PR 1 will switch the frontend to branch on `outcome`.

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`ocr:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({
        outcome: "rejected",
        reason: "rate_limit",
        success: false,
        error: "Too many requests. Try again later.",
      }, { status: 429 })
    }

    // Verify caller has a valid member session
    const { getMemberSession } = await import("@/lib/auth")
    const session = await getMemberSession()
    if (!session) {
      Sentry.captureMessage("ocr_auth_rejected", {
        level: "warning",
        tags: {
          route: "/api/ocr",
          reason: "auth",
        },
        extra: {
          // optional chain: NextRequest always defines `cookies` in prod, but
          // the route's regression tests (__tests__/ocr-route-stage-c.test.ts)
          // mock `request` without it. The hasCookie tag is observability —
          // not worth turning the 401 into a 500 when the mock is bare.
          hasCookie: !!request.cookies?.get("amasi_member_token"),
          hasBearer: !!request.headers.get("authorization"),
          userAgent: request.headers.get("user-agent"),
          referer: request.headers.get("referer"),
        },
      })
      return Response.json({
        outcome: "rejected",
        reason: "auth",
        success: false,
        error: "Please verify your email first",
      }, { status: 401 })
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null
    const rawDocType = formData.get("docType") as string

    if (!file || !rawDocType) {
      return Response.json({
        outcome: "rejected",
        reason: "missing_input",
        success: false,
        error: "Missing file or docType",
      }, { status: 400 })
    }

    // Validate file size
    if (file.size > 5 * 1024 * 1024) {
      return Response.json({
        outcome: "rejected",
        reason: "file_too_large",
        success: false,
        error: "File too large. Maximum 5 MB.",
      }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())

    // Validate magic bytes — only accept JPEG, PNG, PDF
    const isJPEG = buffer[0] === 0xFF && buffer[1] === 0xD8
    const isPNG = buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47
    const isPDF = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46
    if (!isJPEG && !isPNG && !isPDF) {
      return Response.json({
        outcome: "rejected",
        reason: "invalid_format",
        success: false,
        error: "Invalid file format. Only JPG, PNG, and PDF are accepted.",
      }, { status: 400 })
    }

    const docType = normalizeDocumentKey(rawDocType)
    const ext = isPDF ? "pdf" : isPNG ? "png" : "jpg"
    const contentType = file.type || (isPDF ? "application/pdf" : isPNG ? "image/png" : "image/jpeg")

    // ---------------------------------------------------------------------
    // Storage-before-classify: every byte that survives input validation
    // must be in Supabase before we look at it. The reviewer queue depends
    // on this — without a fileUrl, "needs manual review" is meaningless.
    // ---------------------------------------------------------------------
    // Stage C (2026-05-23): supabase client is hoisted out of the storage
    // block so it's in scope for the persistOcrUploadToDraft calls on the
    // two success-return paths below (outcome:"stored" and "extracted").
    // The storage upload itself still happens BEFORE any draft mutate —
    // the storage-before-mutate ordering is preserved.
    const { createAdminClient } = await import("@/lib/supabase")
    const supabase = createAdminClient()

    let fileUrl: string | null = null
    {
      const folder = requiresExtraction(docType) ? docType : "photo"
      const fileName = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const { error: uploadError } = await supabase.storage.from("uploads").upload(fileName, buffer, {
        contentType,
        upsert: false,
      })
      if (uploadError) {
        // Hard fail: an application without a stored file cannot be sent to
        // a reviewer, so we must not pretend the upload succeeded. This is
        // a behaviour change from pre-PR-0 where storage failures were
        // silently swallowed and the user was returned a "fileUrl: null"
        // success response — the path that produced 6 paid+broken apps.
        console.error("[ocr] storage upload failed:", uploadError.message)
        Sentry.captureException(new Error(`OCR storage upload failed: ${uploadError.message}`), {
          tags: { flow: "ocr_upload", stage: "storage" },
        })
        // Best-effort: tag the applicant's draft with a system_* failure_reason
        // so the admin /incomplete view can surface storage-fault drafts.
        // Lookup by email (verified session); errors swallowed — the 500
        // below is what the client sees regardless.
        try {
          const sessionEmail = (session.email as string) || ""
          if (sessionEmail) {
            const { data: draftRow } = await supabase
              .from("draft_applications")
              .select("id")
              .eq("email", sessionEmail)
              .is("deleted_at", null)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle()
            if (draftRow?.id) {
              await supabase
                .from("draft_applications")
                .update({ failure_reason: "system_upload_failed_no_fileurl" })
                .eq("id", draftRow.id)
            }
          }
        } catch (e) {
          console.error("[ocr] failure_reason tag write threw:", e)
        }
        return Response.json({
          outcome: "rejected",
          reason: "ocr_service_error",
          success: false,
          error: "Could not save your document. Please try again in a moment.",
        }, { status: 500 })
      }
      // Phase B: store the object PATH, not a public URL. The uploads bucket is
      // going private, at which point every stored public URL 404s. Reads sign
      // the path at the API boundary (src/lib/storage-url.ts). fileUrl is never
      // rendered as an img src or href in the apply flow — it is a validation
      // token (validateRequiredDocuments) and the value copied onto the member
      // row — so a bare path is safe here.
      fileUrl = fileName
    }

    // Profile photos don't need OCR — return after storage
    if (!requiresExtraction(docType)) {
      void recordStepEvent({
        email: (session.email as string) || "",
        eventType: "doc_upload",
        step: 3,
        status: "uploaded",
        metadata: { docType, bytes: buffer.length, ocr_skipped: true },
      })
      // ── Stage C: server-side draft write (outcome:"stored") ──
      // Persist the upload entry into draft.step_data.uploads.<rawDocType>
      // so the client's fire-and-forget save-draft is no longer load-bearing.
      // Uses the RAW docType (e.g. "profile"), NOT the normalized canonical
      // ("photo") — see persist-ocr-upload.ts ALLOWED_DOC_KEYS rationale.
      // Failures inside the helper are logged + swallowed; the response
      // shape below is unchanged regardless of persist result.
      await persistOcrUploadToDraft({
        supabase,
        email: (session.email as string) || "",
        docKey: rawDocType,
        entry: {
          status: "uploaded",
          fileUrl,
          extracted: {},
        },
      })
      return Response.json({
        outcome: "stored",
        success: true,           // legacy
        extracted: {},           // legacy
        docType,
        fileUrl,
      })
    }

    // Run extraction via shared library
    const result = await extractDocument({ buffer, fileName: file.name, docType })

    // Extraction returned isValid:false — route to manual review WITH the
    // file. Two sub-cases distinguished by extractDocument's engineError flag:
    //
    //   engineError === true  -> OCR pipeline itself failed (Claude+OCR.space
    //                            both down, sharp threw, JSON parse failed,
    //                            etc.). reason: "ocr_service_error".
    //   engineError !== true  -> AI ran fine and judged this not the right
    //                            document (semantic reject). reason:
    //                            "ocr_below_threshold".
    //
    // The reviewer queue chip surfaces the distinction so triage isn't
    // misled. See src/lib/document-keys.ts MANUAL_REVIEW_REASON_CODES.
    if (!result.isValid) {
      const reason = manualReviewReasonForExtractionFailure(result.engineError)
      void recordStepEvent({
        email: (session.email as string) || "",
        eventType: "doc_upload",
        step: 3,
        status: "rejected",
        metadata: {
          docType,
          reason: result.rejectionReason || "invalid",
          engine: result.engine,
          manual_review_reason: reason,
        },
      })
      return Response.json({
        outcome: "manual_review_required",
        reason,
        success: false,                    // legacy
        isIrrelevant: true,                // legacy
        extracted: result.extracted,       // legacy (partial / empty)
        message: result.rejectionReason || (
          reason === "ocr_service_error"
            ? "We hit a snag reading this document. Our team will review it."
            : "Could not read this clearly. Our team will review it."
        ),
        docType,
        fileUrl,
      })
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

    // ── Stage C: server-side draft write (outcome:"extracted") ──
    // Persist the extracted entry into draft.step_data.uploads.<rawDocType>.
    // Uses the RAW client-sent key, NOT the normalized canonical — the
    // client hard-codes "profile" in React state and writing under the
    // normalized "photo" would duplicate-and-corrupt the JSONB. See
    // persist-ocr-upload.ts. Failures inside the helper are logged +
    // swallowed; the response below is unchanged regardless.
    await persistOcrUploadToDraft({
      supabase,
      email: (session.email as string) || "",
      docKey: rawDocType,
      entry: {
        status: "extracted",
        fileUrl,
        extracted: result.extracted,
        message: `Extracted ${Object.keys(result.extracted || {}).length} fields`,
      },
    })

    return Response.json({
      outcome: "extracted",
      success: true,                       // legacy
      extracted: result.extracted,
      eligibility: result.eligibility,
      expiryWarnings: result.expiryWarnings.length > 0 ? result.expiryWarnings : undefined,
      docType,
      engine: result.engine,
      fileUrl,
    })
  } catch (error) {
    console.error("OCR API error:", error)
    Sentry.captureException(error, { tags: { flow: "ocr_upload", stage: "top_catch" } })
    // We don't have a fileUrl here — anything in the try-block before storage
    // would have returned its own response; if we reach this catch, the file
    // was either not stored or the failure happened post-storage in
    // extractDocument. In the latter case extractDocument already swallows
    // its own errors and returns isValid:false, so this catch is for truly
    // unexpected throws (request parsing, OOM, etc). Treat as hard reject.
    return Response.json({
      outcome: "rejected",
      reason: "ocr_service_error",
      success: false,
      error: "Could not process this document. Please try a clearer image.",
    }, { status: 500 })
  }
}
