// POST /api/mou/upload — attachment upload for event-hosting applications.
//
// Auth: active member session (resolveMouApplicant). Allowlisted in
// middleware PUBLIC_API_ROUTES under "/api/mou/" because the member cookie
// is not the admin cookie; the handler does its own check.
//
// Ingestion posture:
// - 10 MB cap, magic-byte sniff (PDF / JPEG / PNG) — the declared MIME and
//   the extension are ignored for the decision; the sniffed type picks both
//   the stored content-type and the extension.
// - Stored under mou/<member_id>/<uuid>.<ext>. The client file name is never
//   part of the path; it is returned (sanitised) for display only.
// - Per-member rate limit so one account can't fill the bucket.
// - Returns a bare storage path (store paths, sign on read) plus a 1h signed
//   URL for the immediate preview.
import { NextRequest } from "next/server"
import { randomUUID } from "node:crypto"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getMemberSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { resolveMouApplicant, applicantErrorResponse } from "@/lib/mou-member"
import { safeDisplayFilename } from "@/lib/mou-applications"
import { MOU_UPLOAD_MAX_BYTES } from "@/lib/mou-events"
import { UPLOADS_BUCKET } from "@/lib/storage-url"

function sniff(bytes: Uint8Array): { ext: "pdf" | "jpg" | "png"; contentType: string } | null {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return { ext: "pdf", contentType: "application/pdf" }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", contentType: "image/jpeg" }
  }
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { ext: "png", contentType: "image/png" }
  }
  return null
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const who = await resolveMouApplicant(supabase, await getMemberSession())
  if (!who.ok) return applicantErrorResponse(who)
  const { member_id } = who.applicant

  const rl = await checkRateLimit(`mou-upload:${member_id}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many uploads. Please try again in a few minutes." },
      { status: 429 }
    )
  }

  try {
    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File) || file.size === 0) {
      return Response.json({ status: false, message: "No file provided" }, { status: 400 })
    }
    if (file.size > MOU_UPLOAD_MAX_BYTES) {
      return Response.json(
        { status: false, message: "File exceeds the 10 MB limit" },
        { status: 400 }
      )
    }

    const buffer = new Uint8Array(await file.arrayBuffer())
    const kind = sniff(buffer.subarray(0, 8))
    if (!kind) {
      return Response.json(
        { status: false, message: "Only PDF, JPG and PNG files are accepted" },
        { status: 400 }
      )
    }

    const path = `mou/${member_id}/${randomUUID()}.${kind.ext}`
    const { error: uploadError } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .upload(path, buffer, { contentType: kind.contentType, upsert: false })

    if (uploadError) {
      Sentry.captureException(uploadError, { tags: { route: "api/mou/upload" } })
      return Response.json({ status: false, message: "Upload failed" }, { status: 500 })
    }

    const { data: signed } = await supabase.storage
      .from(UPLOADS_BUCKET)
      .createSignedUrl(path, 60 * 60)

    return Response.json({
      status: true,
      attachment: {
        path,
        filename: safeDisplayFilename(file.name),
        size: file.size,
        content_type: kind.contentType,
      },
      url: signed?.signedUrl ?? null,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "api/mou/upload" } })
    return Response.json({ status: false, message: "Upload failed" }, { status: 500 })
  }
}
