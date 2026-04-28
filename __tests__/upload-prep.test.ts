/**
 * Unit tests for src/lib/upload-prep.ts.
 *
 * The module is browser-only (canvas, FileReader, dynamic-imported HEIC
 * decoder). Vitest runs in node, so we exercise only the deterministic
 * branches that don't need a real DOM:
 *   - PDF size guard (small accept, large reject with stable user message)
 *   - Unknown format reject
 *   - HEIC dispatch (mocked decoder)
 *
 * Image-compression and the actual HEIC decode path require a browser
 * canvas / WebAssembly runtime; those are exercised by the manual code-walk
 * in PR 1's Step 4 test report, not here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prepareFileForUpload } from "@/lib/upload-prep"

function fakeFile(name: string, type: string, size: number): File {
  // Build an actual File with the right .size, without allocating real bytes
  // for huge cases. Vitest's File polyfill respects the Blob length.
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

describe("prepareFileForUpload — non-browser-canvas paths", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("accepts a small PDF as-is", async () => {
    const f = fakeFile("doc.pdf", "application/pdf", 500_000) // 500 KB
    const r = await prepareFileForUpload(f)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.file).toBe(f)
  })

  it("rejects a PDF over the 3.5 MB cap with a stable user message", async () => {
    const f = fakeFile("doc.pdf", "application/pdf", 5_000_000) // 5 MB
    const r = await prepareFileForUpload(f)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("pdf_too_large")
      expect(r.userMessage).toContain("PDF")
      expect(r.userMessage.toLowerCase()).toContain("compress")
    }
  })

  it("rejects an unknown format (e.g. .docx)", async () => {
    const f = fakeFile("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", 200_000)
    const r = await prepareFileForUpload(f)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("unsupported_format")
      expect(r.userMessage.toLowerCase()).toContain("jpg")
    }
  })

  it("HEIC dispatch surfaces a clear user message when the decoder throws", async () => {
    // Mock heic-to to throw so we exercise the error branch without a real
    // libheif WASM runtime. The lazy-import in upload-prep resolves to this
    // mock thanks to vi.doMock+resetModules.
    vi.doMock("heic-to", () => ({
      heicTo: vi.fn().mockRejectedValue(new Error("simulated heic failure")),
    }))
    const { prepareFileForUpload: prep } = await import("@/lib/upload-prep")
    const f = fakeFile("photo.HEIC", "image/heic", 2_000_000)
    const r = await prep(f)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe("heic_decode_failed")
      expect(r.userMessage.toLowerCase()).toContain("heic")
    }
    vi.doUnmock("heic-to")
  })

  it("HEIC detection fires on extension even when MIME is empty (iOS share quirk)", async () => {
    vi.doMock("heic-to", () => ({
      heicTo: vi.fn().mockRejectedValue(new Error("forced")),
    }))
    const { prepareFileForUpload: prep } = await import("@/lib/upload-prep")
    const f = fakeFile("IMG_1234.heic", "", 1_000_000) // empty MIME, .heic ext
    const r = await prep(f)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe("heic_decode_failed")
    vi.doUnmock("heic-to")
  })
})
