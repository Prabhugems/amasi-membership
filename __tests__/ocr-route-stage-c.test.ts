/**
 * Stage C integration tests on /api/ocr — confirms the only-success-writes
 * contract by line-number:
 *   - outcome:"extracted" (route.ts ~225) → persist called ONCE
 *   - outcome:"stored"    (route.ts ~156) → persist called ONCE
 *   - outcome:"manual_review_required" (~194) → persist NOT called
 *   - outcome:"rejected"  (each sub-reason) → persist NOT called
 *   - top-level catch     (~278) → persist NOT called
 *
 * Plus the no-throw guarantee: if persist fails (returns ok:false), the
 * OCR route's response shape and status code are unchanged.
 *
 * Mocking strategy mirrors __tests__/payment-document-gating.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"
import type { PersistOcrUploadResult } from "@/lib/persist-ocr-upload"

// ── Mock persist-ocr-upload to count calls and inspect args ────────────────
// vi.mock factories are hoisted to the top of the file, so the persist fn
// has to be declared via vi.hoisted to be available inside the factory.
// The mock signature is typed to the helper's full result union so tests
// can override with failure shapes (db_error, conflict_after_retry, etc.).
type PersistArgs = {
  supabase: unknown
  email: string
  docKey: string
  entry: {
    status: string
    fileUrl: string
    extracted: Record<string, unknown>
    message?: string
  }
}
const { persistMock } = vi.hoisted(() => ({
  persistMock: vi.fn<(args: PersistArgs) => Promise<unknown>>(async () => ({
    ok: true,
    persisted: true,
  })),
}))
vi.mock("@/lib/persist-ocr-upload", () => ({
  persistOcrUploadToDraft: persistMock,
}))

// ── Mock auth: always allow, return a valid session ─────────────────────────
vi.mock("@/lib/auth", () => ({
  getMemberSession: vi.fn(async () => ({ email: "applicant@test.local" })),
}))

// ── Mock rate limit: always allow ───────────────────────────────────────────
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 99, resetAt: Date.now() + 1000 })),
}))

// ── Mock funnel tracking — no-op ────────────────────────────────────────────
vi.mock("@/lib/funnel-tracking", () => ({
  recordStepEvent: vi.fn(async () => undefined),
}))

// ── Mock supabase storage so .upload + .getPublicUrl succeed by default ────
let storageShouldFail = false
vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: vi.fn(async () => (storageShouldFail ? { error: { message: "boom" } } : { error: null })),
        getPublicUrl: vi.fn((path: string) => ({
          data: { publicUrl: `https://storage.test/uploads/${path}` },
        })),
      }),
    },
  })),
}))

// ── Mock document-extraction — control isValid / engineError per test ──────
type ExtractResult = {
  isValid: boolean
  engineError: boolean
  extracted: Record<string, unknown>
  eligibility: { eligible: boolean; reason: string } | null
  expiryWarnings: string[]
  engine: "claude-vision" | "tesseract"
  rejectionReason: string | null
  extractionDurationMs: number
}
let nextExtractResult: ExtractResult = {
  isValid: true,
  engineError: false,
  extracted: { full_name: "Test", registration_number: "1234" },
  eligibility: null,
  expiryWarnings: [],
  engine: "claude-vision",
  rejectionReason: null,
  extractionDurationMs: 100,
}
let extractShouldThrow = false
vi.mock("@/lib/document-extraction", () => ({
  extractDocument: vi.fn(async () => {
    if (extractShouldThrow) throw new Error("synthetic extraction crash")
    return nextExtractResult
  }),
}))

// Required env (set before route import)
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.invalid"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role"

import { POST } from "@/app/api/ocr/route"
import type { NextRequest } from "next/server"

// File magic bytes — JPEG header (0xFF 0xD8 + 0xFF E0 ... 0xFF 0xD9)
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])

function buildRequest(docType: string, fileBytes: Uint8Array = JPEG_MAGIC): NextRequest {
  const form = new FormData()
  form.append("docType", docType)
  form.append("file", new Blob([fileBytes as BlobPart], { type: "image/jpeg" }), "test.jpg")
  return new Request("https://test.local/api/ocr", { method: "POST", body: form }) as unknown as NextRequest
}

beforeEach(() => {
  persistMock.mockClear()
  persistMock.mockReset()
  persistMock.mockImplementation(
    async (): Promise<PersistOcrUploadResult> => ({ ok: true, persisted: true }),
  )
  storageShouldFail = false
  extractShouldThrow = false
  nextExtractResult = {
    isValid: true,
    engineError: false,
    extracted: { full_name: "Test", registration_number: "1234" },
    eligibility: null,
    expiryWarnings: [],
    engine: "claude-vision",
    rejectionReason: null,
    extractionDurationMs: 100,
  }
})

describe("POST /api/ocr — Stage C only-success-writes contract", () => {
  // ── Success paths: persist called exactly once ──
  it('outcome:"extracted" (required doc) → persistOcrUploadToDraft called ONCE with raw docKey', async () => {
    const res = await POST(buildRequest("mci_certificate"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outcome).toBe("extracted")
    expect(persistMock).toHaveBeenCalledTimes(1)
    const args = persistMock.mock.calls[0][0]
    expect(args.docKey).toBe("mci_certificate")
    expect(args.entry.status).toBe("extracted")
    expect(args.entry.fileUrl).toMatch(/^https:\/\/storage\.test\/uploads\/mci_certificate\//)
    expect(args.entry.extracted).toEqual({ full_name: "Test", registration_number: "1234" })
  })

  it('outcome:"stored" (profile photo) → persist called ONCE with raw docKey "profile" (NOT normalized "photo")', async () => {
    const res = await POST(buildRequest("profile"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outcome).toBe("stored")
    expect(persistMock).toHaveBeenCalledTimes(1)
    const args = persistMock.mock.calls[0][0]
    // CRUCIAL: docKey is the raw "profile", not the normalized "photo".
    // Writing under "photo" would corrupt step_data.uploads vs. the client's
    // hard-coded "profile" key. See persist-ocr-upload.ts ALLOWED_DOC_KEYS.
    expect(args.docKey).toBe("profile")
    expect(args.entry.status).toBe("uploaded")
    expect(args.entry.fileUrl).toMatch(/^https:\/\/storage\.test\/uploads\/photo\//) // storage folder is "photo", that's fine
    expect(args.entry.extracted).toEqual({})
  })

  // ── No-write paths: persist NEVER called ──
  it('outcome:"manual_review_required" (extract isValid:false) → persist NOT called', async () => {
    nextExtractResult.isValid = false
    nextExtractResult.engineError = false
    const res = await POST(buildRequest("mci_certificate"))
    const body = await res.json()
    expect(body.outcome).toBe("manual_review_required")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it('outcome:"manual_review_required" with engineError:true (OCR service failure) → persist NOT called', async () => {
    nextExtractResult.isValid = false
    nextExtractResult.engineError = true
    const res = await POST(buildRequest("mci_certificate"))
    const body = await res.json()
    expect(body.outcome).toBe("manual_review_required")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it("rejected (rate_limit) → persist NOT called", async () => {
    const { checkRateLimit } = await import("@/lib/rate-limit")
    vi.mocked(checkRateLimit).mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      resetAt: Date.now() + 1000,
    })
    const res = await POST(buildRequest("mci_certificate"))
    const body = await res.json()
    expect(body.outcome).toBe("rejected")
    expect(body.reason).toBe("rate_limit")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it("rejected (auth) → persist NOT called", async () => {
    const { getMemberSession } = await import("@/lib/auth")
    vi.mocked(getMemberSession).mockResolvedValueOnce(null)
    const res = await POST(buildRequest("mci_certificate"))
    const body = await res.json()
    expect(body.outcome).toBe("rejected")
    expect(body.reason).toBe("auth")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it("rejected (missing_input — no docType) → persist NOT called", async () => {
    const form = new FormData()
    form.append("file", new Blob([JPEG_MAGIC], { type: "image/jpeg" }), "x.jpg")
    const req = new Request("https://test.local/api/ocr", { method: "POST", body: form }) as unknown as NextRequest
    const res = await POST(req)
    const body = await res.json()
    expect(body.outcome).toBe("rejected")
    expect(body.reason).toBe("missing_input")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it("rejected (file_too_large) → persist NOT called", async () => {
    const form = new FormData()
    form.append("docType", "mci_certificate")
    // 6 MB blob > 5 MB limit. We build the Blob directly (avoiding the
    // BlobPart-from-Uint8Array typing issue) — the route's size check
    // happens before the magic-byte check so the content doesn't matter.
    form.append("file", new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: "image/jpeg" }), "big.jpg")
    const req = new Request("https://test.local/api/ocr", { method: "POST", body: form }) as unknown as NextRequest
    const res = await POST(req)
    const body = await res.json()
    expect(body.outcome).toBe("rejected")
    expect(body.reason).toBe("file_too_large")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it("rejected (invalid_format) → persist NOT called", async () => {
    const garbage = new Uint8Array([0x00, 0x00, 0x00, 0x00]) // not JPEG/PNG/PDF
    const res = await POST(buildRequest("mci_certificate", garbage))
    const body = await res.json()
    expect(body.outcome).toBe("rejected")
    expect(body.reason).toBe("invalid_format")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it("rejected (storage upload failed, ocr_service_error) → persist NOT called", async () => {
    storageShouldFail = true
    const res = await POST(buildRequest("mci_certificate"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.outcome).toBe("rejected")
    expect(body.reason).toBe("ocr_service_error")
    expect(persistMock).not.toHaveBeenCalled()
  })

  it("top-level throw (synthetic extraction crash) → persist NOT called, route returns rejected/500", async () => {
    extractShouldThrow = true
    const res = await POST(buildRequest("mci_certificate"))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.outcome).toBe("rejected")
    expect(body.reason).toBe("ocr_service_error")
    expect(persistMock).not.toHaveBeenCalled()
  })

  // ── No-throw guarantee on persist failure ──
  it("persist returns ok:false (conflict_after_retry) → route STILL returns normal success response", async () => {
    persistMock.mockImplementationOnce(
      async (): Promise<PersistOcrUploadResult> => ({
        ok: false,
        persisted: false,
        reason: "conflict_after_retry",
      }),
    )
    const res = await POST(buildRequest("mci_certificate"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outcome).toBe("extracted")
    expect(body.fileUrl).toMatch(/^https:\/\/storage\.test\/uploads\/mci_certificate\//)
    // The OCR response shape is preserved even when the persist failed.
  })

  it("persist returns ok:false (db_error) → route STILL returns normal success response", async () => {
    persistMock.mockImplementationOnce(
      async (): Promise<PersistOcrUploadResult> => ({
        ok: false,
        persisted: false,
        reason: "db_error",
        error: new Error("synthetic db failure"),
      }),
    )
    const res = await POST(buildRequest("mci_certificate"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outcome).toBe("extracted")
  })

  it("persist returns no_draft → route STILL returns normal success response", async () => {
    persistMock.mockImplementationOnce(
      async (): Promise<PersistOcrUploadResult> => ({
        ok: true,
        persisted: false,
        reason: "no_draft",
      }),
    )
    const res = await POST(buildRequest("profile"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.outcome).toBe("stored")
    expect(body.fileUrl).toMatch(/^https:\/\/storage\.test\/uploads\/photo\//)
  })
})
