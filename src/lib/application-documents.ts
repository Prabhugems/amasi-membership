/**
 * How the admin dashboard addresses an uploaded application document.
 *
 * The browser is deliberately NOT given a signed Supabase URL. A signed URL is
 * a bearer token for a doctor's certificate — anyone holding the string can
 * fetch the file for the next hour, signed in or not — and handing one to the
 * client leaves it in history, in the DOM, and in page source. Instead every
 * document is addressed by (application, key) and streamed back through
 * /api/applications/[id]/document/[key], which re-checks the admin session on
 * every request. The browser then only ever talks to this origin.
 */

/**
 * One entry in `membership_applications.documents`. The index signature is
 * there because the blob also carries OCR output that varies per document
 * type; only these three fields are ever read by the dashboard chrome.
 */
export interface ApplicationDocument {
  fileUrl?: string | null
  url?: string | null
  status?: string
  [extra: string]: unknown
}

/** The one place a document URL is built. */
export function documentHref(applicationId: string, docKey: string): string {
  return `/api/applications/${encodeURIComponent(applicationId)}/document/${encodeURIComponent(docKey)}`
}

export type DocumentKind = "image" | "pdf" | "other"

/**
 * How to render it.
 *
 * Read from the STORED value, not from the href — the href has no extension by
 * design, and sniffing a type out of a URL was how the old code decided
 * between <img> and <iframe>. The stored path keeps its original extension
 * whether it is a bare path or a signed URL.
 */
export function documentKind(doc: ApplicationDocument | null | undefined): DocumentKind {
  const stored = doc?.fileUrl || doc?.url
  if (!stored) return "other"
  const withoutQuery = stored.split("?")[0]
  if (/\.pdf$/i.test(withoutQuery)) return "pdf"
  if (/\.(jpe?g|png|webp|gif)$/i.test(withoutQuery)) return "image"
  return "other"
}

/** True when there is something to show at all. */
export function hasDocument(doc: ApplicationDocument | null | undefined): boolean {
  return Boolean(doc?.fileUrl || doc?.url)
}
