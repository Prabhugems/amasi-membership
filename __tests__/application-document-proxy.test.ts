import { describe, it, expect } from "vitest"
import { documentHref, documentKind, hasDocument } from "@/lib/application-documents"

/**
 * The admin dashboard addresses documents by (application, key) and never by a
 * storage URL. These tests pin the two properties that makes safe:
 *   1. the browser is never handed a credential, and
 *   2. the render decision does not depend on sniffing a type out of a URL.
 */

describe("documentHref", () => {
  it("addresses a document by application and key, never by storage path", () => {
    const href = documentHref("31918323-bcd4-4331-82bf-4c70d334d5d8", "mci_certificate")
    expect(href).toBe("/api/applications/31918323-bcd4-4331-82bf-4c70d334d5d8/document/mci_certificate")
    // Same origin as the dashboard — the whole point.
    expect(href.startsWith("/")).toBe(true)
  })

  // A signed URL is a bearer token for a doctor's certificate. If one ever
  // reappears in what the client holds, this is the test that should fail.
  it("carries no token, no bucket and no supabase host", () => {
    const href = documentHref("app-id", "profile")
    expect(href).not.toContain("token=")
    expect(href).not.toContain("supabase")
    expect(href).not.toContain("uploads")
  })

  it("escapes a key that would otherwise climb out of the path", () => {
    const href = documentHref("app-id", "../../../etc/passwd")
    expect(href).not.toContain("../")
    expect(href).toBe("/api/applications/app-id/document/..%2F..%2F..%2Fetc%2Fpasswd")
  })
})

describe("documentKind", () => {
  // Read from the STORED value: the href has no extension by design, and
  // guessing the type from the URL is what the old lightbox did.
  it("reads the type from a bare stored path", () => {
    expect(documentKind({ fileUrl: "photo/1790002756014-xr8t2e.jpg" })).toBe("image")
    expect(documentKind({ fileUrl: "mci_certificate/abc.pdf" })).toBe("pdf")
  })

  it("still reads the type from a legacy full URL, query string and all", () => {
    expect(
      documentKind({ fileUrl: "https://x.supabase.co/storage/v1/object/sign/uploads/a/b.pdf?token=eyJ" })
    ).toBe("pdf")
    expect(
      documentKind({ fileUrl: "https://x.supabase.co/storage/v1/object/public/uploads/a/b.JPEG" })
    ).toBe("image")
  })

  it("falls back to 'other' rather than guessing", () => {
    expect(documentKind({ fileUrl: "a/b.docx" })).toBe("other")
    expect(documentKind({ fileUrl: "" })).toBe("other")
    expect(documentKind(null)).toBe("other")
    expect(documentKind(undefined)).toBe("other")
  })

  // ".pdf" anywhere in the string used to be enough to pick the <iframe>.
  it("does not match an extension that merely appears mid-path", () => {
    expect(documentKind({ fileUrl: "my.pdf.notes/scan.jpg" })).toBe("image")
  })
})

describe("hasDocument", () => {
  it("accepts either stored field and rejects empties", () => {
    expect(hasDocument({ fileUrl: "a/b.jpg" })).toBe(true)
    expect(hasDocument({ url: "a/b.jpg" })).toBe(true)
    expect(hasDocument({ fileUrl: "", url: null })).toBe(false)
    expect(hasDocument(null)).toBe(false)
  })
})

/**
 * The route resolves `key` against the row's own documents blob. A plain index
 * would resolve inherited properties, so a caller could name "constructor" and
 * get a truthy object back. This pins the lookup rule the route relies on.
 */
describe("document key lookup", () => {
  const lookup = (docs: Record<string, unknown>, key: string) =>
    Object.prototype.hasOwnProperty.call(docs, key) ? docs[key] : null

  it("finds a real document key", () => {
    expect(lookup({ profile: { fileUrl: "a.jpg" } }, "profile")).toEqual({ fileUrl: "a.jpg" })
  })

  it("refuses inherited properties", () => {
    const docs = { profile: { fileUrl: "a.jpg" } }
    expect(lookup(docs, "constructor")).toBeNull()
    expect(lookup(docs, "__proto__")).toBeNull()
    expect(lookup(docs, "toString")).toBeNull()
    expect(lookup(docs, "nope")).toBeNull()
  })
})
