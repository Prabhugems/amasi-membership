/**
 * Tests for the uploads-bucket path normaliser (Phase B of making the bucket
 * private).
 *
 * The bucket has been public since the beginning, so document columns hold a
 * mix of full public URLs (written by ocr/, applications/resubmit/,
 * admin/attach-document/, mobile shim) and bare paths (written by
 * members/upload/). Every read has to cope with both, which is what
 * toStoragePath exists to guarantee.
 */
import { describe, it, expect } from "vitest"
import { toStoragePath } from "@/lib/storage-url"

const PUBLIC_BASE = "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads"
const SIGN_BASE = "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/sign/uploads"

describe("toStoragePath", () => {
  it("extracts the path from a public URL (the legacy shape)", () => {
    expect(toStoragePath(`${PUBLIC_BASE}/mci_certificate/1785988996267-d1c76c.pdf`))
      .toBe("mci_certificate/1785988996267-d1c76c.pdf")
  })

  it("passes a bare path through unchanged (what members/upload already writes)", () => {
    expect(toStoragePath("members/2b0f9a1c-1111-2222-3333-444455556666/mci_certificate_1712345678.pdf"))
      .toBe("members/2b0f9a1c-1111-2222-3333-444455556666/mci_certificate_1712345678.pdf")
  })

  it("strips the token from an already-signed URL so it can be re-signed", () => {
    expect(toStoragePath(`${SIGN_BASE}/photo/abc.jpg?token=eyJhbGciOi.some.thing`))
      .toBe("photo/abc.jpg")
  })

  it("decodes percent-encoding, so spaces in legacy filenames survive", () => {
    expect(toStoragePath(`${PUBLIC_BASE}/letter_hod/scan%20of%20letter.pdf`))
      .toBe("letter_hod/scan of letter.pdf")
  })

  it("returns null for empty-ish input", () => {
    expect(toStoragePath(null)).toBeNull()
    expect(toStoragePath(undefined)).toBeNull()
    expect(toStoragePath("")).toBeNull()
    expect(toStoragePath("   ")).toBeNull()
  })

  it("returns null for a URL pointing at a different bucket", () => {
    expect(toStoragePath(
      "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/form-uploads/x.pdf",
    )).toBeNull()
  })

  it("returns null for an unrelated absolute URL, so legacy S3 links pass through untouched", () => {
    expect(toStoragePath("https://member2025.s3.ap-south-1.amazonaws.com/events/scan.png")).toBeNull()
  })

  it("rejects traversal and absolute paths", () => {
    expect(toStoragePath("../../etc/passwd")).toBeNull()
    expect(toStoragePath("/etc/passwd")).toBeNull()
    expect(toStoragePath("members/../../secrets/key.pem")).toBeNull()
  })

  it("is idempotent — normalising an already-normalised path is a no-op", () => {
    const once = toStoragePath(`${PUBLIC_BASE}/asi_member_certificate/x.pdf`)
    expect(toStoragePath(once)).toBe(once)
  })
})
