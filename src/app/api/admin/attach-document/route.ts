// Admin-only endpoint for attaching documents on behalf of an applicant
// (e.g. when the applicant emails the doc instead of uploading via the
// apply page). Replaces the scripts/<name>-attach-docs-*.mjs pattern.
//
// Routes by `kind`:
//   - "application" → writes to applications.documents JSONB
//   - "draft"       → writes to draft_applications.step_data.uploads JSONB
//
// Always sets bypass: true + bypassReason: "user_bypass" on every entry —
// admin never sees a checkbox. Forgetting this marker is the Karki /
// Karmakar bug class: validateRequiredDocuments() in the approve gate
// rejects entries without it (see CONTEXT.md "Fragile areas").

import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { mergeDraftUploads, type MergeUploadEntry } from "@/lib/merge-draft-uploads"

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB, matches other upload routes

// Allowlist kept in lockstep with persist-ocr-upload.ts. If apply page
// adds a new doc type, update both. Includes "profile" alias for the
// photo slot — that's what the apply page hard-codes in React state.
const ALLOWED_DOC_KEYS = new Set([
  "profile",
  "photo",
  "mci_certificate",
  "pg_degree_certificate",
  "mbbs_degree_certificate",
  "asi_member_certificate",
  "letter_hod",
  "active_license",
])

function getRequestIp(req: NextRequest): string | undefined {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    undefined
  )
}

function extFromFile(file: File): string {
  const fromName = file.name.split(".").pop()?.toLowerCase()
  if (fromName && /^[a-z0-9]{1,5}$/.test(fromName)) return fromName
  const fromType = file.type.split("/").pop()?.toLowerCase()
  if (fromType === "jpeg") return "jpg"
  if (fromType && /^[a-z0-9]{1,5}$/.test(fromType)) return fromType
  return "bin"
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ status: false, message: "Expected multipart form-data" }, { status: 400 })
  }

  const kind = String(form.get("kind") || "")
  const id = String(form.get("id") || "")
  const docKey = String(form.get("docKey") || "")
  const file = form.get("file")

  if (kind !== "application" && kind !== "draft") {
    return Response.json({ status: false, message: "kind must be 'application' or 'draft'" }, { status: 400 })
  }
  if (!id) {
    return Response.json({ status: false, message: "id is required" }, { status: 400 })
  }
  if (!ALLOWED_DOC_KEYS.has(docKey)) {
    return Response.json({ status: false, message: `Unknown docKey '${docKey}'` }, { status: 400 })
  }
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ status: false, message: "file is required" }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ status: false, message: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024} MB)` }, { status: 400 })
  }

  const supabase = createAdminClient()

  // ─── 1. Upload to storage ──────────────────────────────────────────────
  // Path matches the applicant-upload convention: <docKey>/<ts>-<rand>.<ext>.
  const ext = extFromFile(file)
  const storagePath = `${docKey}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage.from("uploads").upload(storagePath, buffer, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  })

  if (uploadError) {
    Sentry.captureException(uploadError, {
      tags: { route: "admin/attach-document", op: "storage_upload", doc_key: docKey, kind },
      extra: { id, storagePath },
    })
    return Response.json({ status: false, message: "Storage upload failed" }, { status: 500 })
  }

  const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(storagePath)
  const fileUrl = urlData?.publicUrl
  if (!fileUrl) {
    Sentry.captureMessage("admin/attach-document: getPublicUrl returned no url", {
      level: "warning",
      tags: { route: "admin/attach-document", doc_key: docKey, kind },
      extra: { id, storagePath },
    })
    return Response.json({ status: false, message: "Failed to resolve public URL" }, { status: 500 })
  }

  // ─── 2. Build the doc entry ────────────────────────────────────────────
  // Same shape used by applicant upload + the scripts/<name>-attach-docs
  // backfills. bypass markers are non-negotiable — admin-attached docs are
  // not OCR-verified, and the approve gate looks for these to allow the
  // application through.
  const entry: MergeUploadEntry = {
    status: "uploaded",
    fileUrl,
    extracted: {},
    message: `Admin attached on behalf of applicant (${typeof session.email === "string" ? session.email : "unknown"})`,
    bypass: true,
    bypassReason: "user_bypass",
  }

  // ─── 3. Write to the right table ───────────────────────────────────────
  if (kind === "application") {
    const { data: app, error: readErr } = await supabase
      .from("applications")
      .select("id, documents, email")
      .eq("id", id)
      .maybeSingle()
    if (readErr || !app) {
      Sentry.captureException(readErr ?? new Error("application not found"), {
        tags: { route: "admin/attach-document", op: "read_application" },
        extra: { id },
      })
      return Response.json({ status: false, message: "Application not found" }, { status: 404 })
    }
    const existingDocs = (app.documents || {}) as Record<string, unknown>
    const mergedDocs: Record<string, unknown> = { ...existingDocs, [docKey]: entry }
    const { error: updErr } = await supabase
      .from("applications")
      .update({ documents: mergedDocs })
      .eq("id", id)
    if (updErr) {
      Sentry.captureException(updErr, {
        tags: { route: "admin/attach-document", op: "update_application", doc_key: docKey },
        extra: { id, storagePath },
      })
      return Response.json({ status: false, message: "Failed to update application" }, { status: 500 })
    }
    await logAdminAction({
      adminEmail: typeof session.email === "string" ? session.email : "unknown",
      adminName: typeof session.name === "string" ? session.name : undefined,
      action: "attach_document",
      entityType: "application",
      entityId: id,
      entityName: app.email,
      details: { docKey, fileUrl, filename: file.name, size: file.size, bypassReason: "user_bypass" },
      ipAddress: getRequestIp(request),
    })
    return Response.json({ status: true, kind, id, docKey, fileUrl })
  }

  // kind === "draft"
  const { data: draft, error: readErr } = await supabase
    .from("draft_applications")
    .select("id, step_data, email, updated_at")
    .eq("id", id)
    .maybeSingle()
  if (readErr || !draft) {
    Sentry.captureException(readErr ?? new Error("draft not found"), {
      tags: { route: "admin/attach-document", op: "read_draft" },
      extra: { id },
    })
    return Response.json({ status: false, message: "Draft not found" }, { status: 404 })
  }
  const existingStepData = (draft.step_data || {}) as Record<string, unknown>
  const existingUploads =
    (existingStepData.uploads as Record<string, unknown> | undefined) ?? null
  // Re-uses the Stage B merge helper so admin writes are additive with
  // any concurrent OCR / save-draft writes (rule 1 installs the new
  // entry because incoming has a truthy fileUrl).
  const mergedUploads = mergeDraftUploads(existingUploads, { [docKey]: entry } as Record<string, unknown>)
  const mergedStepData = { ...existingStepData, uploads: mergedUploads }

  const { error: updErr } = await supabase
    .from("draft_applications")
    .update({ step_data: mergedStepData, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("updated_at", draft.updated_at)
  if (updErr) {
    Sentry.captureException(updErr, {
      tags: { route: "admin/attach-document", op: "update_draft", doc_key: docKey },
      extra: { id, storagePath },
    })
    return Response.json({ status: false, message: "Failed to update draft" }, { status: 500 })
  }

  await logAdminAction({
    adminEmail: typeof session.email === "string" ? session.email : "unknown",
    adminName: typeof session.name === "string" ? session.name : undefined,
    action: "attach_document",
    entityType: "draft",
    entityId: id,
    entityName: draft.email,
    details: { docKey, fileUrl, filename: file.name, size: file.size, bypassReason: "user_bypass" },
    ipAddress: getRequestIp(request),
  })

  return Response.json({ status: true, kind, id, docKey, fileUrl })
}
