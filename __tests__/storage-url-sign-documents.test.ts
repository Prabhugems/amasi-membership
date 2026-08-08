/**
 * Regression test: /api/applications/list (and any other route returning
 * membership_applications rows to a browser) must sign documents.*.fileUrl
 * before responding.
 *
 * Root cause of the bug this closes: Phase B (src/lib/storage-url.ts) made
 * document-upload write paths (ocr/, resubmit/) store bare storage paths
 * instead of public URLs. The admin /pending dashboard renders
 * doc.fileUrl directly as <img src>, so once a path landed unsigned the
 * image request resolved against the dashboard's own origin and 404'd —
 * confirmed against a real pending_review row where every fileUrl was a
 * bare path like "mci_certificate/1786097943694-6iskkq.jpg".
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const createSignedUrlsMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: (bucket: string) => {
        if (bucket !== "uploads") throw new Error(`Unmocked bucket: ${bucket}`)
        return { createSignedUrls: createSignedUrlsMock }
      },
    },
  })),
}))

import { signDocumentsAcrossRows } from "@/lib/storage-url"

beforeEach(() => {
  createSignedUrlsMock.mockReset()
  createSignedUrlsMock.mockImplementation(async (paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}?token=abc` })),
    error: null,
  }))
})

describe("signDocumentsAcrossRows", () => {
  it("signs a bare storage path (the post-Phase-B write shape)", async () => {
    const rows = [
      {
        id: "app-1",
        documents: {
          mci_certificate: { status: "extracted", fileUrl: "mci_certificate/123-abc.jpg" },
        },
      },
    ]
    const [result] = await signDocumentsAcrossRows(rows)
    expect(result.documents.mci_certificate.fileUrl).toBe(
      "https://signed.example/mci_certificate/123-abc.jpg?token=abc",
    )
    // Non-URL fields on the doc entry must survive untouched.
    expect(result.documents.mci_certificate.status).toBe("extracted")
  })

  it("signs a legacy full public URL by normalising to a path first", async () => {
    const rows = [
      {
        id: "app-2",
        documents: {
          profile: {
            status: "uploaded",
            fileUrl:
              "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads/photo/456-def.jpg",
          },
        },
      },
    ]
    const [result] = await signDocumentsAcrossRows(rows)
    expect(result.documents.profile.fileUrl).toBe("https://signed.example/photo/456-def.jpg?token=abc")
  })

  it("handles a single application with a mix of both shapes across doc types (observed in prod)", async () => {
    const rows = [
      {
        id: "app-3",
        documents: {
          profile: {
            fileUrl: "https://jmdwxymbgxwdsmcwbahp.supabase.co/storage/v1/object/public/uploads/photo/1.jpg",
          },
          letter_hod: { fileUrl: "letter_hod/2.pdf" },
          mci_certificate: { fileUrl: "mci_certificate/3.jpg" },
        },
      },
    ]
    const [result] = await signDocumentsAcrossRows(rows)
    expect(result.documents.profile.fileUrl).toBe("https://signed.example/photo/1.jpg?token=abc")
    expect(result.documents.letter_hod.fileUrl).toBe("https://signed.example/letter_hod/2.pdf?token=abc")
    expect(result.documents.mci_certificate.fileUrl).toBe("https://signed.example/mci_certificate/3.jpg?token=abc")
  })

  it("batches signing across multiple rows into a single createSignedUrls call", async () => {
    const rows = [
      { id: "app-a", documents: { photo: { fileUrl: "photo/a.jpg" } } },
      { id: "app-b", documents: { photo: { fileUrl: "photo/b.jpg" } } },
    ]
    await signDocumentsAcrossRows(rows)
    expect(createSignedUrlsMock).toHaveBeenCalledTimes(1)
    expect(createSignedUrlsMock.mock.calls[0][0].sort()).toEqual(["photo/a.jpg", "photo/b.jpg"])
  })

  it("leaves rows with no documents untouched and makes no signing call", async () => {
    const rows: { id: string; documents: Record<string, unknown> | null }[] = [
      { id: "app-4", documents: {} },
      { id: "app-5", documents: null },
    ]
    const result = await signDocumentsAcrossRows(rows)
    expect(result[0].documents).toEqual({})
    expect(result[1].documents).toBeNull()
    expect(createSignedUrlsMock).not.toHaveBeenCalled()
  })

  it("nulls out fileUrl when signing fails, rather than leaking the raw path", async () => {
    createSignedUrlsMock.mockResolvedValue({ data: null, error: { message: "boom" } })
    const rows = [{ id: "app-6", documents: { photo: { fileUrl: "photo/fail.jpg" } } }]
    const [result] = await signDocumentsAcrossRows(rows)
    expect(result.documents.photo.fileUrl).toBeNull()
  })
})
