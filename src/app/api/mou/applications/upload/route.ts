// @auth: public but OTP-gated — uploads the two supporting photos
// (committee-member photo, institution photo) that some event types require
// on the MOU application form BEFORE the application row exists (the
// applicant hasn't submitted yet, so there's no application id to attach
// the file to). No other upload endpoint fits this caller: /api/members/upload
// requires an authenticated member/admin session plus an existing
// members.id, and /api/ocr requires a member session cookie — MOU applicants
// never get either, since verifyMouOtp (src/lib/mou/otp.ts) only marks an
// otp_codes row verified, it does not issue a session cookie the way the
// general /api/otp/verify flow does for /apply.
//
// Trust posture: rather than accept fully-anonymous uploads (the
// src/app/api/tickets/upload/route.ts precedent), this route requires the
// caller to already have a verified otp_codes row for the given email within
// the last hour — the same check POST /api/mou/applications performs before
// creating the application row. This ties upload usage to a genuine
// in-progress applicant instead of leaving the "uploads" bucket open to
// anyone who can reach this URL, at the cost of one extra required field.
import { NextRequest } from "next/server"
import { randomUUID } from "crypto"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5 MB — matches /api/members/upload
const VALID_DOC_TYPES = new Set(["committee_member_photo", "institution_photo"])

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

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`mou-upload:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many uploads. Please try again later." }, { status: 429 })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return Response.json({ status: false, message: "Invalid upload" }, { status: 400 })
  }

  const file = formData.get("file")
  const docType = formData.get("docType")
  const email = formData.get("email")

  if (!(file instanceof File) || typeof docType !== "string" || typeof email !== "string") {
    return Response.json({ status: false, message: "file, docType, and email are required" }, { status: 400 })
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

  const supabase = createAdminClient()

  // Require an OTP-verified email within the last hour — same window/check
  // as POST /api/mou/applications. Blocks anonymous drive-by storage abuse
  // without requiring a full account/session for MOU applicants.
  const { data: verifiedOtp } = await supabase
    .from("otp_codes")
    .select("id")
    .eq("email", email.trim().toLowerCase())
    .eq("verified", true)
    .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!verifiedOtp) {
    return Response.json({ status: false, message: "Please verify your email with the code first" }, { status: 400 })
  }

  const headerBytes = new Uint8Array(await file.slice(0, 8).arrayBuffer())
  const sniffed = sniffType(headerBytes)
  if (!sniffed) {
    return Response.json({ status: false, message: "Invalid file format. Only JPG, PNG, or PDF files are accepted." }, { status: 400 })
  }

  // Fully server-generated storage path — never the client-supplied
  // filename — so there is no path-traversal or overwrite surface.
  const storagePath = `mou-applications/${randomUUID()}-${docType}.${sniffed.ext}`
  const buffer = new Uint8Array(await file.arrayBuffer())

  const { error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(storagePath, buffer, { contentType: sniffed.mime, upsert: false })
  if (uploadError) {
    console.error("mou upload: storage upload failed:", uploadError.message)
    return Response.json({ status: false, message: "Failed to upload file" }, { status: 500 })
  }

  // These fields (committee_member_photo_url / institution_photo_url) are
  // stored as durable public URL strings on the application row (see
  // src/lib/mou/types.ts) for the reviewer/admin UI to display later — a
  // signed URL would expire before a reviewer opens the application, so use
  // a public URL, matching the pattern the decide route already uses for
  // the generated MOU PDF itself.
  const { data: publicUrlData } = supabase.storage.from("uploads").getPublicUrl(storagePath)
  return Response.json({ status: true, url: publicUrlData.publicUrl })
}
