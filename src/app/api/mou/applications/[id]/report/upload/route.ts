// @auth: public — capability is the application id (a UUID), same model
// as GET /api/mou/applications/[id] ("the id acts as the capability
// token; there is no separate login for applicants"). No OTP re-check
// here: the report is submitted well after the OTP window from
// application time has expired (event happens weeks/months later), so
// there's nothing to re-verify — knowing the id is the applicant's proof,
// same as the status page already assumes.
import { NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getApplicationById } from "@/lib/mou/supabase-helpers"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB — matches /api/mou/applications/upload
const VALID_DOC_TYPES = new Set(["report", "photo"])

// Content-sniff by magic bytes, not the client-declared MIME type or
// filename extension — per rafter-secure-design ingestion guidance, allowlist
// by sniffed content, and never trust a client-supplied filename/extension
// for the storage path. Extension used below is derived from the sniff
// result, not from file.name.
function sniffType(bytes: Uint8Array): { mime: string; ext: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mime: "image/jpeg", ext: "jpg" }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { mime: "image/png", ext: "png" }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return { mime: "application/pdf", ext: "pdf" }
  return null
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-report-upload:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many uploads. Please try again later." }, { status: 429 })
  }

  const application = await getApplicationById(id)
  if (!application) return Response.json({ status: false, message: "Not found" }, { status: 404 })
  if (application.status !== "approved" && application.status !== "completed") {
    return Response.json({ status: false, message: "This application isn't approved — there's no event to report on." }, { status: 400 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ status: false, message: "Invalid upload" }, { status: 400 })
  }

  const file = formData.get("file")
  const docType = formData.get("docType")

  if (!(file instanceof File) || typeof docType !== "string") {
    return Response.json({ status: false, message: "file and docType are required" }, { status: 400 })
  }
  if (!VALID_DOC_TYPES.has(docType)) {
    return Response.json({ status: false, message: "Invalid document type" }, { status: 400 })
  }
  if (file.size === 0) {
    return Response.json({ status: false, message: "Empty file" }, { status: 400 })
  }
  if (file.size > MAX_FILE_SIZE) {
    return Response.json({ status: false, message: "File too large. Maximum 5 MB." }, { status: 400 })
  }

  const headerBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const sniffed = sniffType(headerBytes)
  if (!sniffed) {
    return Response.json({ status: false, message: "Invalid file format. Only JPG, PNG, or PDF files are accepted." }, { status: 400 })
  }

  // Fully server-generated storage path — never the client-supplied
  // filename — so there is no path-traversal or overwrite surface. Scoped
  // under the application's own id so signApplicationsStorage's
  // OWNED_REPORT_PREFIX check (src/lib/mou/supabase-helpers.ts) has
  // something to validate against.
  const storagePath = `mou-reports/${id}/${randomUUID()}-${docType}.${sniffed.ext}`
  const buffer = new Uint8Array(await file.arrayBuffer())

  const supabase = createAdminClient()
  const { error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(storagePath, buffer, { contentType: sniffed.mime, upsert: false })
  if (uploadError) {
    console.error("mou report upload: storage upload failed:", uploadError.message)
    return Response.json({ status: false, message: "Failed to upload file" }, { status: 500 })
  }

  // Bare path, not a public URL — the `uploads` bucket is private
  // (sql/024). Signed fresh on read via signApplicationsStorage.
  return Response.json({ status: true, url: storagePath })
}
