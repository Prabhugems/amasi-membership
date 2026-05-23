/**
 * Stage A regression tests — restoreDraftUploads must preserve fileUrl,
 * bypass, and bypassReason when present in step_data.uploads. The pre-Stage-A
 * inline restore loop dropped them, producing the silent-loss path that
 * stranded six paid applicants on 2026-05-23.
 *
 * Pinned by: src/lib/restore-draft-uploads.ts (header comment for full
 * incident history).
 */

import { describe, it, expect } from "vitest"
import { restoreDraftUploads } from "@/lib/restore-draft-uploads"

describe("restoreDraftUploads — Stage A", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // The bug this PR exists to fix: fileUrl + bypass markers preserved
  // ─────────────────────────────────────────────────────────────────────────

  it("preserves fileUrl when present (the Stage A fix)", () => {
    const out = restoreDraftUploads({
      mci_certificate: {
        status: "extracted",
        fileUrl: "https://storage.example/mci.pdf",
        extracted: { registration_number: "12345" },
        message: "Extracted 7 fields",
      },
    })
    expect(out.mci_certificate.fileUrl).toBe("https://storage.example/mci.pdf")
    expect(out.mci_certificate.status).toBe("extracted")
    expect(out.mci_certificate.extracted).toEqual({ registration_number: "12345" })
    expect(out.mci_certificate.message).toBe("Extracted 7 fields")
  })

  it("preserves bypass + bypassReason when present and valid", () => {
    const out = restoreDraftUploads({
      pg_degree_certificate: {
        status: "uploaded",
        fileUrl: "https://storage.example/pg.pdf",
        bypass: true,
        bypassReason: "ocr_below_threshold",
        extracted: {},
      },
    })
    expect(out.pg_degree_certificate.bypass).toBe(true)
    expect(out.pg_degree_certificate.bypassReason).toBe("ocr_below_threshold")
    expect(out.pg_degree_certificate.fileUrl).toBe("https://storage.example/pg.pdf")
  })

  it("preserves user_bypass bypassReason (zukabk pattern)", () => {
    // The MANUAL_REVIEW_REASON_CODES allowlist must include user_bypass —
    // it's what admin-attach scripts (Stage 4 manual recovery) use.
    const out = restoreDraftUploads({
      mci_certificate: {
        status: "uploaded",
        fileUrl: "u",
        bypass: true,
        bypassReason: "user_bypass",
      },
    })
    expect(out.mci_certificate.bypass).toBe(true)
    expect(out.mci_certificate.bypassReason).toBe("user_bypass")
  })

  it("preserves face_detection_failed bypassReason (profile photo bypass)", () => {
    const out = restoreDraftUploads({
      profile: {
        status: "uploaded",
        fileUrl: "u",
        bypass: true,
        bypassReason: "face_detection_failed",
      },
    })
    expect(out.profile.bypassReason).toBe("face_detection_failed")
  })

  it("preserves ocr_service_error bypassReason", () => {
    const out = restoreDraftUploads({
      mci_certificate: {
        status: "uploaded",
        fileUrl: "u",
        bypass: true,
        bypassReason: "ocr_service_error",
      },
    })
    expect(out.mci_certificate.bypassReason).toBe("ocr_service_error")
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Defensive: garbage bypass shapes are stripped (avoid forging gate pass)
  // ─────────────────────────────────────────────────────────────────────────

  it("omits bypass when bypass !== true (truthy but not strictly true)", () => {
    const out = restoreDraftUploads({
      mci_certificate: { status: "extracted", fileUrl: "u", bypass: 1, bypassReason: "ocr_below_threshold" },
    })
    expect("bypass" in out.mci_certificate).toBe(false)
    expect("bypassReason" in out.mci_certificate).toBe(false)
  })

  it("omits bypass when bypass is false", () => {
    const out = restoreDraftUploads({
      mci_certificate: { status: "extracted", fileUrl: "u", bypass: false },
    })
    expect("bypass" in out.mci_certificate).toBe(false)
  })

  it("omits bypass when bypassReason is not a recognised code", () => {
    const out = restoreDraftUploads({
      mci_certificate: { status: "uploaded", fileUrl: "u", bypass: true, bypassReason: "garbage_reason" },
    })
    expect("bypass" in out.mci_certificate).toBe(false)
    expect("bypassReason" in out.mci_certificate).toBe(false)
  })

  it("omits bypass when bypassReason is missing entirely", () => {
    const out = restoreDraftUploads({
      mci_certificate: { status: "uploaded", fileUrl: "u", bypass: true },
    })
    expect("bypass" in out.mci_certificate).toBe(false)
    expect("bypassReason" in out.mci_certificate).toBe(false)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // fileUrl shapes
  // ─────────────────────────────────────────────────────────────────────────

  it("omits fileUrl gracefully when not provided", () => {
    const out = restoreDraftUploads({
      profile: { status: "uploaded", extracted: {} },
    })
    expect("fileUrl" in out.profile).toBe(false)
  })

  it("preserves explicit null fileUrl when persisted as null", () => {
    // Documents the "fileUrl was set to null intentionally" shape — distinct
    // from "fileUrl never set". Both are persistable; both produce a slot
    // that won't pass isRequiredSlotValid downstream.
    const out = restoreDraftUploads({
      profile: { status: "uploaded", fileUrl: null, extracted: {} },
    })
    expect(out.profile.fileUrl).toBeNull()
  })

  it("preserves empty-string fileUrl as-is (no auto-normalisation)", () => {
    // We deliberately don't normalise "" to null here. The downstream
    // isRequiredSlotValid trims and checks length, so either shape is
    // safely rejected by the gate.
    const out = restoreDraftUploads({
      profile: { status: "uploaded", fileUrl: "", extracted: {} },
    })
    expect(out.profile.fileUrl).toBe("")
  })

  it("omits non-string-or-null fileUrl shapes", () => {
    const out = restoreDraftUploads({
      profile: { status: "uploaded", fileUrl: 42, extracted: {} },
    })
    expect("fileUrl" in out.profile).toBe(false)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Status / extracted / message defaults (must match pre-Stage-A behaviour)
  // ─────────────────────────────────────────────────────────────────────────

  it("defaults status to 'uploaded' when missing", () => {
    const out = restoreDraftUploads({ x: { fileUrl: "u" } })
    expect(out.x.status).toBe("uploaded")
  })

  it("defaults status to 'uploaded' when value is not a recognised status", () => {
    const out = restoreDraftUploads({ x: { status: "nonsense", fileUrl: "u" } })
    expect(out.x.status).toBe("uploaded")
  })

  it("preserves each recognised status verbatim", () => {
    for (const s of ["processing", "extracted", "uploaded", "rejected", "blocked"] as const) {
      const out = restoreDraftUploads({ x: { status: s, fileUrl: "u" } })
      expect(out.x.status).toBe(s)
    }
  })

  it("defaults extracted to empty object when missing", () => {
    const out = restoreDraftUploads({ x: { status: "extracted", fileUrl: "u" } })
    expect(out.x.extracted).toEqual({})
  })

  it("defaults extracted to empty object when not an object", () => {
    const out = restoreDraftUploads({ x: { status: "extracted", fileUrl: "u", extracted: "garbage" } })
    expect(out.x.extracted).toEqual({})
  })

  it("defaults message to 'Restored from previous session' when missing", () => {
    const out = restoreDraftUploads({ x: { status: "extracted", fileUrl: "u" } })
    expect(out.x.message).toBe("Restored from previous session")
  })

  it("preserves persisted message verbatim", () => {
    const out = restoreDraftUploads({ x: { status: "extracted", fileUrl: "u", message: "Extracted 12 fields" } })
    expect(out.x.message).toBe("Extracted 12 fields")
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Always-null file + always-"" preview (browser state can't be revived)
  // ─────────────────────────────────────────────────────────────────────────

  it("always sets file=null and preview='' on restored entries", () => {
    const out = restoreDraftUploads({
      mci_certificate: { status: "extracted", fileUrl: "u", extracted: {} },
    })
    expect(out.mci_certificate.file).toBeNull()
    expect(out.mci_certificate.preview).toBe("")
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Skipping / no-op shapes
  // ─────────────────────────────────────────────────────────────────────────

  it("skips non-object upload entries (null, primitive, etc.)", () => {
    const out = restoreDraftUploads({
      good: { status: "extracted", fileUrl: "u" },
      bad_null: null,
      bad_string: "not an object",
      bad_number: 0,
      bad_bool: true,
    })
    expect(Object.keys(out).sort()).toEqual(["good"])
  })

  it("returns {} for null / undefined / non-object input", () => {
    expect(restoreDraftUploads(null)).toEqual({})
    expect(restoreDraftUploads(undefined)).toEqual({})
    expect(restoreDraftUploads("nonsense")).toEqual({})
    expect(restoreDraftUploads(42)).toEqual({})
    expect(restoreDraftUploads(true)).toEqual({})
  })

  it("returns {} for an empty object", () => {
    expect(restoreDraftUploads({})).toEqual({})
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Realistic round-trips (mirrors actual prod draft shapes from 2026-05-22)
  // ─────────────────────────────────────────────────────────────────────────

  it("round-trips the Nishat case: 3 uploads with intact fileUrls + extracted data", () => {
    // The pre-Stage-A failure mode: this exact JSONB shape would lose all
    // three fileUrls on restore, making the slots fail isRequiredSlotValid.
    const stepDataUploads = {
      profile: {
        status: "uploaded",
        fileUrl: "https://storage.example/photo.png",
        extracted: {},
      },
      mci_certificate: {
        status: "extracted",
        fileUrl: "https://storage.example/mci.pdf",
        message: "Extracted 7 fields",
        extracted: { registration_number: "70687", council_name: "West Bengal Medical Council" },
      },
      pg_degree_certificate: {
        status: "extracted",
        fileUrl: "https://storage.example/pg.pdf",
        message: "Extracted 7 fields",
        extracted: { degree_name: "M.S.", year_of_passing: "2019" },
      },
    }
    const out = restoreDraftUploads(stepDataUploads)
    expect(out.profile.fileUrl).toBe("https://storage.example/photo.png")
    expect(out.mci_certificate.fileUrl).toBe("https://storage.example/mci.pdf")
    expect(out.pg_degree_certificate.fileUrl).toBe("https://storage.example/pg.pdf")
    expect(out.mci_certificate.extracted).toEqual({
      registration_number: "70687",
      council_name: "West Bengal Medical Council",
    })
    expect(out.pg_degree_certificate.extracted).toEqual({
      degree_name: "M.S.",
      year_of_passing: "2019",
    })
  })

  it("round-trips the bypass-path case: extracted MCI + bypassed PG", () => {
    // A user who passed MCI cleanly but had to bypass PG (OCR rejected
    // the doc as below threshold; user clicked "submit for manual review").
    const stepDataUploads = {
      mci_certificate: {
        status: "extracted",
        fileUrl: "https://storage.example/mci.pdf",
        extracted: { registration_number: "85384" },
      },
      pg_degree_certificate: {
        status: "uploaded",
        fileUrl: "https://storage.example/pg.pdf",
        message: "Extracted data contains financial terms. This does not appear to be a medical degree certificate.",
        bypass: true,
        bypassReason: "ocr_below_threshold",
        extracted: {},
      },
    }
    const out = restoreDraftUploads(stepDataUploads)
    expect(out.mci_certificate.status).toBe("extracted")
    expect(out.mci_certificate.fileUrl).toBe("https://storage.example/mci.pdf")
    expect(out.pg_degree_certificate.status).toBe("uploaded")
    expect(out.pg_degree_certificate.fileUrl).toBe("https://storage.example/pg.pdf")
    expect(out.pg_degree_certificate.bypass).toBe(true)
    expect(out.pg_degree_certificate.bypassReason).toBe("ocr_below_threshold")
  })
})
