/**
 * Rehydrate the `uploads` map from a draft application's persisted
 * `step_data.uploads` so a resumed session sees the same upload tiles as
 * valid as they were before the page unload.
 *
 * BUG HISTORY (Stage A of the upload-cure, 2026-05-23):
 *   This logic previously lived as an inline arrow at apply/page.tsx and
 *   dropped `fileUrl`, `bypass`, and `bypassReason` when restoring. After
 *   resume, `isRequiredSlotValid` (which requires fileUrl) failed even
 *   though the user had successfully uploaded — the slot looked invalid
 *   and the next save-draft would propagate the empty fileUrl back to
 *   the server, which combined with the shallow merge at
 *   save-draft/route.ts:87 erased the row's reference to the file in
 *   storage. Six applicants needed manual rebuilds on 2026-05-23 because
 *   of this (Vidhi, Punam, Shahnawaz, Nishat — Barman and Zuka had
 *   different but related shapes).
 *
 *   Stage B will fix the server-side merge so even a buggy client write
 *   can't clobber an existing fileUrl. Stage C will move uploads writing
 *   into /api/ocr server-side so the client save-draft is no longer
 *   load-bearing. Stage A (this module) is the cheapest, lowest-risk
 *   slice and runs entirely on the client.
 */

import type { ManualReviewReasonCode } from "./document-keys"

/**
 * Structural subset of apply/page.tsx's UploadEntry that the resume path
 * can populate. `file` is always null and `preview` always "" because the
 * original File blob and object-URL are browser-only and can't be
 * serialised into step_data — the user must re-pick the file if they
 * want to overwrite the slot before submit. Every other UploadEntry
 * field is preserved when present in step_data.uploads.
 */
export interface RestoredUploadEntry {
  file: File | null
  preview: string
  status: "processing" | "extracted" | "uploaded" | "rejected" | "blocked"
  extracted: Record<string, unknown>
  message?: string
  fileUrl?: string | null
  bypass?: boolean
  bypassReason?: ManualReviewReasonCode
}

const ALLOWED_STATUS = new Set<RestoredUploadEntry["status"]>([
  "processing",
  "extracted",
  "uploaded",
  "rejected",
  "blocked",
])

// Mirrors MANUAL_REVIEW_REASON_CODES from src/lib/document-keys.ts. Kept
// as a local Set rather than importing the runtime tuple to avoid a
// circular dependency if document-keys ever pulls anything from here.
const ALLOWED_REASON_CODES = new Set<ManualReviewReasonCode>([
  "ocr_below_threshold",
  "ocr_service_error",
  "user_bypass",
  "face_detection_failed",
])

export function restoreDraftUploads(
  stepDataUploads: unknown,
): Record<string, RestoredUploadEntry> {
  if (!stepDataUploads || typeof stepDataUploads !== "object") return {}

  const out: Record<string, RestoredUploadEntry> = {}
  for (const [key, raw] of Object.entries(stepDataUploads as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue
    const v = raw as Record<string, unknown>

    // Status: default to "uploaded" when missing or not a known value. This
    // matches the pre-Stage-A inline behaviour so existing draft rows
    // restore identically; the only thing changing is what *additional*
    // fields survive.
    const statusRaw = v.status
    const status: RestoredUploadEntry["status"] =
      typeof statusRaw === "string" && (ALLOWED_STATUS as Set<string>).has(statusRaw)
        ? (statusRaw as RestoredUploadEntry["status"])
        : "uploaded"

    const extracted =
      v.extracted && typeof v.extracted === "object"
        ? (v.extracted as Record<string, unknown>)
        : {}

    const message = typeof v.message === "string" ? v.message : "Restored from previous session"

    const entry: RestoredUploadEntry = {
      file: null,
      preview: "",
      status,
      extracted,
      message,
    }

    // fileUrl: carry through string (any string, including "") and null,
    // both of which are persistable shapes. Other shapes (undefined,
    // object, number, etc.) mean the slot was never given a URL — omit.
    if (typeof v.fileUrl === "string" || v.fileUrl === null) {
      entry.fileUrl = v.fileUrl
    }

    // bypass markers: only carry through when bypass===true (strict) AND
    // bypassReason is a recognised MANUAL_REVIEW_REASON_CODES code. A
    // partial / corrupted bypass shape is treated as "no bypass" so the
    // restored slot doesn't accidentally pass validateRequiredDocuments
    // rule #4 with garbage.
    if (
      v.bypass === true &&
      typeof v.bypassReason === "string" &&
      (ALLOWED_REASON_CODES as Set<string>).has(v.bypassReason)
    ) {
      entry.bypass = true
      entry.bypassReason = v.bypassReason as ManualReviewReasonCode
    }

    out[key] = entry
  }
  return out
}
