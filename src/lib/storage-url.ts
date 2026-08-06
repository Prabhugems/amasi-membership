/**
 * Storage URL handling for the `uploads` bucket — Phase B of making it private.
 *
 * The bucket has been `public=true` since the beginning, so document columns on
 * `members` and `membership_applications` hold a MIX of two shapes:
 *
 *   1. a full public URL   — https://<ref>.supabase.co/storage/v1/object/public/uploads/mci_certificate/123-abc.pdf
 *   2. a bare object path  — members/<uuid>/mci_certificate_1712345678.pdf
 *
 * (1) is what `ocr/`, `applications/resubmit/`, `admin/attach-document/` and the
 * mobile shim wrote historically; (2) is what `members/upload/` already writes.
 * Once the bucket flips to private every stored public URL 404s, so reads have
 * to go through a signed URL either way.
 *
 * The rule is: **store paths, sign on read.** `toStoragePath` normalises either
 * shape to a path so this works for old and new rows alike, and the sign*
 * helpers turn a path into a time-limited URL at the API boundary — which means
 * client components keep rendering whatever the API hands them and need no
 * change at all.
 */

import { createAdminClient } from "@/lib/supabase"

export const UPLOADS_BUCKET = "uploads"

/** Default lifetime for a signed document URL. Long enough to load a page and
 *  click through a few documents, short enough that a leaked URL ages out. */
export const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60 // 1 hour

// .../storage/v1/object/public/uploads/<path>  (public)
// .../storage/v1/object/sign/uploads/<path>?token=...  (already signed)
const OBJECT_URL_RE = /\/storage\/v1\/object\/(?:public\/|sign\/|authenticated\/)?uploads\/(.+)$/

/**
 * Normalise a stored value to a bare object path inside the uploads bucket.
 *
 * Accepts a full public URL, an already-signed URL, or a bare path. Returns
 * null for anything empty, for a URL pointing at a different bucket, or for an
 * absolute URL we don't recognise (e.g. a legacy S3 link) — callers should fall
 * back to the original value in that case rather than render nothing.
 */
export function toStoragePath(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^https?:\/\//i.test(trimmed)) {
    const match = trimmed.match(OBJECT_URL_RE)
    if (!match) return null // different bucket, or not a Supabase storage URL
    // Strip any query string (a signed URL carries ?token=...)
    const path = match[1].split("?")[0]
    return decodeURIComponent(path) || null
  }

  // Already a bare path. Reject traversal and absolute forms.
  if (trimmed.startsWith("/") || trimmed.includes("..")) return null
  return trimmed
}

/**
 * Sign one stored value. Returns a time-limited URL, or the original value if
 * it isn't an uploads-bucket reference (so unrecognised legacy links still
 * render), or null if signing fails.
 */
export async function signStorageValue(
  value: string | null | undefined,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!value) return null
  const path = toStoragePath(value)
  if (!path) return value // not ours — hand back untouched

  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .createSignedUrl(path, ttlSeconds)

  if (error || !data?.signedUrl) {
    // Deliberately NOT falling back to a public URL: commit f4cd574 removed
    // exactly that fallback because it leaked public URLs on signing failure.
    console.error("[storage-url] sign failed", { path, error: error?.message })
    return null
  }
  return data.signedUrl
}

/**
 * Sign several stored values in one round trip.
 *
 * Returns a Map keyed by the ORIGINAL value, so callers can look up whatever
 * they passed in without tracking index positions.
 */
export async function signStorageValues(
  values: Array<string | null | undefined>,
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()

  // original value -> path, deduped so one path is signed once
  const pathByValue = new Map<string, string>()
  for (const v of values) {
    if (!v) continue
    if (out.has(v) || pathByValue.has(v)) continue
    const path = toStoragePath(v)
    if (path) pathByValue.set(v, path)
    else out.set(v, v) // not ours — pass through
  }
  if (pathByValue.size === 0) return out

  const uniquePaths = Array.from(new Set(pathByValue.values()))
  const supabase = createAdminClient()
  const { data, error } = await supabase.storage
    .from(UPLOADS_BUCKET)
    .createSignedUrls(uniquePaths, ttlSeconds)

  if (error || !data) {
    console.error("[storage-url] batch sign failed", { count: uniquePaths.length, error: error?.message })
    for (const v of pathByValue.keys()) out.set(v, null)
    return out
  }

  const signedByPath = new Map<string, string | null>()
  for (const row of data) {
    // createSignedUrls echoes the requested path back on each row
    if (row.path) signedByPath.set(row.path, row.signedUrl ?? null)
  }
  for (const [value, path] of pathByValue) {
    out.set(value, signedByPath.get(path) ?? null)
  }
  return out
}

/**
 * Sign the named fields of a record in place (returns a copy).
 *
 * The common read-boundary case: take a row out of the database and hand the
 * client signed URLs under the same field names it already expects.
 */
export async function signRecordFields<T extends Record<string, unknown>>(
  record: T,
  fields: readonly string[],
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<T> {
  const values = fields.map((f) => record[f]).filter((v): v is string => typeof v === "string" && v.length > 0)
  if (values.length === 0) return record

  const signed = await signStorageValues(values, ttlSeconds)
  const copy: Record<string, unknown> = { ...record }
  for (const field of fields) {
    const original = record[field]
    if (typeof original === "string" && original) {
      copy[field] = signed.get(original) ?? null
    }
  }
  return copy as T
}

/** Same as signRecordFields, across a list of records, in a single round trip. */
export async function signRecordsFields<T extends Record<string, unknown>>(
  records: T[],
  fields: readonly string[],
  ttlSeconds: number = DEFAULT_SIGNED_URL_TTL_SECONDS,
): Promise<T[]> {
  const values: string[] = []
  for (const r of records) {
    for (const f of fields) {
      const v = r[f]
      if (typeof v === "string" && v) values.push(v)
    }
  }
  if (values.length === 0) return records

  const signed = await signStorageValues(values, ttlSeconds)
  return records.map((r) => {
    const copy: Record<string, unknown> = { ...r }
    for (const f of fields) {
      const v = r[f]
      if (typeof v === "string" && v) copy[f] = signed.get(v) ?? null
    }
    return copy as T
  })
}

/** Document columns carried on `members` and mirrored on applications. */
export const MEMBER_DOCUMENT_FIELDS = [
  "profile_photo",
  "mci_certificate",
  "pg_degree_certificate",
  "mbbs_degree_certificate",
  "asi_member_certificate",
  "active_license",
  "letter_hod",
] as const
