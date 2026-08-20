/**
 * Unit tests for extractStoragePaths() in src/lib/draft-utils.ts.
 *
 * Regression coverage for the 2026-08-20 fix: the function used to match
 * ONLY the legacy full Supabase Storage URL format
 * (/storage/v1/object/(sign|public)/uploads/<path>) via a blanket regex over
 * the whole step_data JSON. Every document uploaded since the Phase B
 * switch (/api/ocr now returns a bare object path instead of a URL) was
 * silently skipped — deleteDraft() (used by both the manual
 * DELETE /api/applications/save-draft endpoint and the cleanup-drafts cron's
 * hard-delete path) looked like it cleaned up storage but left the actual
 * files behind. This is the function that's supposed to guarantee "no need
 * to hold their data" — a regression here means uploaded certificates/IDs
 * silently outlive every "delete" call.
 */
import { describe, it, expect } from "vitest"
import { extractStoragePaths } from "@/lib/draft-utils"

describe("extractStoragePaths", () => {
  it("extracts bare object paths — the current /api/ocr format", () => {
    const stepData = {
      uploads: {
        mci_certificate: { status: "extracted", fileUrl: "mci_certificate/1787127536708-tvffmn.pdf" },
        profile: { status: "uploaded", fileUrl: "photo/1787127623637-jxh8w1.jpg" },
      },
    }
    const paths = extractStoragePaths(stepData)
    expect(paths.sort()).toEqual([
      "mci_certificate/1787127536708-tvffmn.pdf",
      "photo/1787127623637-jxh8w1.jpg",
    ].sort())
  })

  it("extracts the path portion from the legacy full public/signed URL format", () => {
    const stepData = {
      uploads: {
        mci_certificate: {
          status: "extracted",
          fileUrl: "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads/mci_certificate/1782800869557-xndqzv.pdf",
        },
        pg_degree_certificate: {
          status: "extracted",
          fileUrl: "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/sign/uploads/pg_degree_certificate/169-abc.pdf?token=xyz",
        },
      },
    }
    const paths = extractStoragePaths(stepData)
    expect(paths.sort()).toEqual([
      "mci_certificate/1782800869557-xndqzv.pdf",
      "pg_degree_certificate/169-abc.pdf",
    ].sort())
  })

  it("handles a draft with a mix of both formats across different doc types (seen in real prod data)", () => {
    const stepData = {
      uploads: {
        mci_certificate: { status: "extracted", fileUrl: "mci_certificate/new-format.pdf" },
        pg_degree_certificate: {
          status: "extracted",
          fileUrl: "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads/pg_degree_certificate/old-format.pdf",
        },
      },
    }
    const paths = extractStoragePaths(stepData)
    expect(paths.sort()).toEqual(["mci_certificate/new-format.pdf", "pg_degree_certificate/old-format.pdf"].sort())
  })

  it("dedupes when the same path appears twice", () => {
    const stepData = {
      uploads: {
        mci_certificate: { status: "extracted", fileUrl: "mci_certificate/same.pdf" },
        letter_hod: { status: "extracted", fileUrl: "mci_certificate/same.pdf" },
      },
    }
    expect(extractStoragePaths(stepData)).toEqual(["mci_certificate/same.pdf"])
  })

  it("returns [] for a draft with no uploads yet", () => {
    expect(extractStoragePaths({})).toEqual([])
    expect(extractStoragePaths({ uploads: {} })).toEqual([])
  })

  it("returns [] for null/undefined step_data without throwing", () => {
    expect(extractStoragePaths(null)).toEqual([])
    expect(extractStoragePaths(undefined)).toEqual([])
  })

  it("skips entries with no fileUrl, empty fileUrl, or a non-string fileUrl", () => {
    const stepData = {
      uploads: {
        pending_slot: { status: "processing" },
        empty_slot: { status: "uploaded", fileUrl: "" },
        weird_slot: { status: "uploaded", fileUrl: 12345 },
        real_slot: { status: "uploaded", fileUrl: "photo/real.jpg" },
      },
    }
    expect(extractStoragePaths(stepData)).toEqual(["photo/real.jpg"])
  })

  it("does not mistake an arbitrary external http(s) URL for a bare storage path", () => {
    // Defense against a future bug where some other URL shape lands in
    // fileUrl — should be ignored, not passed to storage.remove() verbatim.
    const stepData = {
      uploads: {
        mci_certificate: { status: "uploaded", fileUrl: "https://example.com/not-supabase-storage.pdf" },
      },
    }
    expect(extractStoragePaths(stepData)).toEqual([])
  })
})
