// @auth: admin session required — streams a private application document.
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { UPLOADS_BUCKET, toStoragePath } from "@/lib/storage-url"

/**
 * GET /api/applications/[id]/document/[key]
 *
 * Streams one uploaded document back through this origin instead of handing
 * the browser a signed Supabase URL.
 *
 * WHY THIS EXISTS. A signed URL is a bearer token for a doctor's certificate:
 * whoever holds the string can fetch the file for the next hour, from anywhere,
 * signed in or not. Handing it to the browser puts it in history, in the DOM,
 * and in anything that reads page source. Here the bytes are fetched
 * server-side and access is re-checked against the admin session on EVERY
 * request, so there is nothing to leak or forward. It also means the browser
 * only ever talks to this origin — which is what makes the thumbnails load on
 * networks that can't reach supabase.co.
 *
 * THE PATH NEVER COMES FROM THE URL. `key` selects an entry in the row's own
 * `documents` blob; the storage path is whatever that entry already held. A
 * caller cannot name a path, so traversal and cross-bucket reads are not
 * "validated against" — they are unreachable by construction.
 */

/**
 * What we are willing to render inline. Deliberately narrow, and deliberately
 * NOT derived from the stored metadata: these are files a stranger uploaded.
 *
 * Note what is missing — `image/svg+xml`. An SVG is a script-bearing document,
 * and now that these bytes are served from the admin dashboard's OWN origin,
 * one rendered inline would run in an admin's session. Anything not on this
 * list is sent as an opaque download instead.
 */
const INLINE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"])

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; key: string }> },
) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id, key } = await params

  const supabase = createAdminClient()
  const { data: row, error } = await supabase
    .from("membership_applications")
    .select("documents")
    .eq("id", id)
    .maybeSingle()

  // One shape of "no" for every miss: unknown application, unknown document
  // key, or a stored value that isn't an uploads-bucket reference. Telling
  // them apart would answer questions about rows the caller can't see.
  if (error || !row) return notFound()

  const docs = row.documents as Record<string, { fileUrl?: string | null; url?: string | null }> | null
  // Own-property lookup only — `key` is caller-controlled, and a plain index
  // would happily resolve "constructor" or "__proto__" against the prototype.
  const doc = docs && Object.prototype.hasOwnProperty.call(docs, key) ? docs[key] : null
  if (!doc) return notFound()

  const path = toStoragePath(doc.fileUrl || doc.url)
  if (!path) return notFound()

  const { data: file, error: dlError } = await supabase.storage.from(UPLOADS_BUCKET).download(path)
  if (dlError || !file) {
    // Logged, never echoed: the message carries the storage path.
    console.error("[application-document] download failed", { id, key, error: dlError?.message })
    return notFound()
  }

  const declared = file.type || ""
  const inline = INLINE_TYPES.has(declared)

  return new Response(file.stream(), {
    headers: {
      "Content-Type": inline ? declared : "application/octet-stream",
      "Content-Length": String(file.size),
      // Belt and braces against the one risk this route introduces — user
      // bytes on our own origin. nosniff stops the browser second-guessing
      // the type above; the CSP neutralises any markup that slips through.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": inline ? "inline" : "attachment",
      // A membership certificate has no business in a shared cache, and the
      // admin's own browser cache would outlive their session.
      "Cache-Control": "private, no-store",
    },
  })
}

function notFound() {
  return Response.json({ error: "Not found" }, { status: 404 })
}
