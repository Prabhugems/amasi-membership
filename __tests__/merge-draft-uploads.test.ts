/**
 * Stage B regression tests — mergeDraftUploads must refuse to clobber an
 * existing fileUrl with a null/empty one, must treat `uploads = {}` as a
 * no-op, and must drop a key when the client sends the explicit null
 * removal sentinel.
 *
 * Pinned by: src/lib/merge-draft-uploads.ts (header comment for full
 * incident history — six paid applicants stranded on 2026-05-23).
 */

import { describe, it, expect } from "vitest"
import { mergeDraftUploads } from "@/lib/merge-draft-uploads"

describe("mergeDraftUploads — Stage B", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // Rule 1 — incoming has truthy fileUrl → take incoming
  // ─────────────────────────────────────────────────────────────────────────

  it("rule 1: takes incoming when incoming has a truthy fileUrl (fresh upload)", () => {
    const out = mergeDraftUploads(
      {},
      { mci_certificate: { status: "extracted", fileUrl: "https://new/mci.pdf" } },
    )
    expect(out.mci_certificate.fileUrl).toBe("https://new/mci.pdf")
  })

  it("rule 1: incoming with truthy fileUrl replaces an existing entry (update)", () => {
    const out = mergeDraftUploads(
      { mci_certificate: { status: "extracted", fileUrl: "https://old/mci.pdf" } },
      { mci_certificate: { status: "extracted", fileUrl: "https://new/mci.pdf" } },
    )
    expect(out.mci_certificate.fileUrl).toBe("https://new/mci.pdf")
  })

  it("rule 1: incoming's bypass markers replace existing's when incoming has fileUrl", () => {
    // A clean re-upload that produces a good OCR extraction should be able
    // to clear an earlier bypass marker.
    const out = mergeDraftUploads(
      { mci: { status: "uploaded", fileUrl: "u1", bypass: true, bypassReason: "ocr_below_threshold" } },
      { mci: { status: "extracted", fileUrl: "u2" } },
    )
    expect(out.mci.fileUrl).toBe("u2")
    expect(out.mci.status).toBe("extracted")
    expect("bypass" in out.mci).toBe(false)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 2 — the Stage B fix
  // ─────────────────────────────────────────────────────────────────────────

  it("rule 2 (THE FIX): refuses to clobber existing fileUrl with null", () => {
    const out = mergeDraftUploads(
      { mci: { status: "extracted", fileUrl: "https://s/mci.pdf", extracted: { reg: "X" } } },
      { mci: { status: "extracted", fileUrl: null, extracted: {} } },
    )
    expect(out.mci.fileUrl).toBe("https://s/mci.pdf")
    expect(out.mci.extracted).toEqual({ reg: "X" })
  })

  it("rule 2: refuses to clobber existing fileUrl with empty string", () => {
    const out = mergeDraftUploads(
      { mci: { fileUrl: "https://s/mci.pdf" } },
      { mci: { fileUrl: "" } },
    )
    expect(out.mci.fileUrl).toBe("https://s/mci.pdf")
  })

  it("rule 2: refuses to clobber existing fileUrl with whitespace-only", () => {
    const out = mergeDraftUploads(
      { mci: { fileUrl: "https://s/mci.pdf" } },
      { mci: { fileUrl: "   " } },
    )
    expect(out.mci.fileUrl).toBe("https://s/mci.pdf")
  })

  it("rule 2: preserves existing bypass markers when refusing to clobber", () => {
    const out = mergeDraftUploads(
      { pg: { status: "uploaded", fileUrl: "u", bypass: true, bypassReason: "ocr_below_threshold" } },
      { pg: { status: "uploaded", fileUrl: null } },
    )
    expect(out.pg.bypass).toBe(true)
    expect(out.pg.bypassReason).toBe("ocr_below_threshold")
    expect(out.pg.fileUrl).toBe("u")
  })

  it("rule 2: refuses to clobber when incoming fileUrl is missing entirely (undefined)", () => {
    const out = mergeDraftUploads(
      { mci: { fileUrl: "https://s/mci.pdf" } },
      { mci: { status: "uploaded" } }, // no fileUrl field at all
    )
    expect(out.mci.fileUrl).toBe("https://s/mci.pdf")
  })

  it("rule 2: refuses to clobber when incoming fileUrl is the wrong type (number)", () => {
    const out = mergeDraftUploads(
      { mci: { fileUrl: "https://s/mci.pdf" } },
      { mci: { fileUrl: 42 } } as unknown as Record<string, unknown>,
    )
    expect(out.mci.fileUrl).toBe("https://s/mci.pdf")
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 3 — incoming key absent → keep existing (closes uploads={} hole)
  // ─────────────────────────────────────────────────────────────────────────

  it("rule 3: keeps existing keys that incoming did not mention", () => {
    const out = mergeDraftUploads(
      {
        mci: { fileUrl: "u_mci" },
        profile: { fileUrl: "u_profile" },
        pg: { fileUrl: "u_pg" },
      },
      { mci: { fileUrl: "u_mci" } }, // only mci sent
    )
    expect(out.profile?.fileUrl).toBe("u_profile")
    expect(out.pg?.fileUrl).toBe("u_pg")
    expect(out.mci.fileUrl).toBe("u_mci")
  })

  it("rule 3: uploads = {} is a no-op — every existing entry is preserved", () => {
    const existing = {
      mci: { status: "extracted", fileUrl: "u_mci" },
      profile: { status: "uploaded", fileUrl: "u_profile" },
    }
    const out = mergeDraftUploads(existing, {})
    expect(out.mci.fileUrl).toBe("u_mci")
    expect(out.profile.fileUrl).toBe("u_profile")
    expect(Object.keys(out).sort()).toEqual(["mci", "profile"])
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 4 — existing missing, incoming present → take incoming
  // ─────────────────────────────────────────────────────────────────────────

  it("rule 4: takes incoming when existing has no entry for that key", () => {
    const out = mergeDraftUploads({}, { mci: { fileUrl: "new" } })
    expect(out.mci.fileUrl).toBe("new")
  })

  it("rule 4: takes incoming brand-new entry even when its fileUrl is null", () => {
    // Edge: a "processing" entry with no fileUrl yet — no existing to protect.
    const out = mergeDraftUploads({}, { profile: { status: "processing", fileUrl: null } })
    expect(out.profile.fileUrl).toBeNull()
    expect(out.profile.status).toBe("processing")
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Rule 5 — explicit removal via null sentinel
  // ─────────────────────────────────────────────────────────────────────────

  it("rule 5: incoming null drops the key from merged (removal sentinel)", () => {
    const out = mergeDraftUploads(
      { mci: { fileUrl: "u_mci" }, profile: { fileUrl: "u_profile" } },
      { profile: null }, // explicit removal
    )
    expect("profile" in out).toBe(false)
    expect(out.mci.fileUrl).toBe("u_mci") // other keys preserved by rule 3
  })

  it("rule 5: incoming null on a non-existing key is a no-op (no error)", () => {
    const out = mergeDraftUploads({ mci: { fileUrl: "u" } }, { profile: null })
    expect(Object.keys(out)).toEqual(["mci"])
  })

  it("rule 5: incoming null removes even when existing has a fileUrl (must beat rule 2)", () => {
    // Rule 5 is the deliberate-removal escape hatch. Even if existing has
    // a perfectly valid fileUrl, an explicit null wins.
    const out = mergeDraftUploads(
      { profile: { status: "uploaded", fileUrl: "https://s/photo.png" } },
      { profile: null },
    )
    expect("profile" in out).toBe(false)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Defensive: non-object incoming entries
  // ─────────────────────────────────────────────────────────────────────────

  it("falls back to existing when incoming entry is a non-object (string/number/boolean)", () => {
    const out = mergeDraftUploads(
      { mci: { fileUrl: "u_existing" } },
      { mci: "garbage", profile: 42, x: true } as unknown as Record<string, unknown>,
    )
    expect(out.mci.fileUrl).toBe("u_existing")
    expect("profile" in out).toBe(false) // no existing, garbage incoming → no entry
    expect("x" in out).toBe(false)
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Defensive: null / undefined / non-object inputs at the map level
  // ─────────────────────────────────────────────────────────────────────────

  it("returns {} when both sides are null", () => {
    expect(mergeDraftUploads(null, null)).toEqual({})
    expect(mergeDraftUploads(undefined, undefined)).toEqual({})
    expect(mergeDraftUploads(null, undefined)).toEqual({})
  })

  it("treats null/undefined existing as empty object", () => {
    const out = mergeDraftUploads(null, { mci: { fileUrl: "u" } })
    expect(out.mci.fileUrl).toBe("u")
  })

  it("treats null/undefined incoming as empty incoming — rule 3 keeps everything", () => {
    const out = mergeDraftUploads({ mci: { fileUrl: "u" } }, null)
    expect(out.mci.fileUrl).toBe("u")
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Realistic round-trips
  // ─────────────────────────────────────────────────────────────────────────

  it("post-Stage-A resume scenario: client re-posts identical state, server unchanged", () => {
    const persisted = {
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf", extracted: { reg: "70687" } },
      pg_degree_certificate: { status: "extracted", fileUrl: "https://s/pg.pdf", extracted: { degree: "MS" } },
    }
    const out = mergeDraftUploads(persisted, persisted)
    expect(out.mci_certificate.extracted).toEqual({ reg: "70687" })
    expect(out.pg_degree_certificate.extracted).toEqual({ degree: "MS" })
    expect(out.profile.fileUrl).toBe("https://s/photo.png")
  })

  it("pre-Stage-A bug shape: client sends fileUrl:null for all three, server keeps existing", () => {
    // The exact pattern that stranded Vidhi/Punam/Shahnawaz. Stage A fixed
    // the client; Stage B is defense-in-depth so even if Stage A regresses
    // or a stale client lingers in a browser tab, the row isn't damaged.
    const existing = {
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf", extracted: { reg: "70687" } },
      pg_degree_certificate: { status: "extracted", fileUrl: "https://s/pg.pdf" },
    }
    const incoming = {
      profile: { status: "uploaded", fileUrl: null },
      mci_certificate: { status: "extracted", fileUrl: null, extracted: {} },
      pg_degree_certificate: { status: "extracted", fileUrl: null },
    }
    const out = mergeDraftUploads(existing, incoming)
    expect(out.profile.fileUrl).toBe("https://s/photo.png")
    expect(out.mci_certificate.fileUrl).toBe("https://s/mci.pdf")
    expect(out.mci_certificate.extracted).toEqual({ reg: "70687" })
    expect(out.pg_degree_certificate.fileUrl).toBe("https://s/pg.pdf")
  })

  it("handleRemoveFile flow: client sends { docType: null } sparse payload, server removes only that key", () => {
    // The new client contract for Stage B: handleRemoveFile no longer
    // omits the key — it sends null explicitly. The save-draft payload
    // can therefore be sparse (just the removed key) and the rest of
    // the row is preserved by rule 3.
    const existing = {
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      mci_certificate: { status: "extracted", fileUrl: "https://s/mci.pdf" },
      pg_degree_certificate: { status: "extracted", fileUrl: "https://s/pg.pdf" },
    }
    const incoming = { profile: null } // user clicked Remove on the profile photo
    const out = mergeDraftUploads(existing, incoming)
    expect("profile" in out).toBe(false)
    expect(out.mci_certificate.fileUrl).toBe("https://s/mci.pdf")
    expect(out.pg_degree_certificate.fileUrl).toBe("https://s/pg.pdf")
  })

  it("failed re-upload preserves the prior good entry (improvement over pre-Stage-B)", () => {
    // User had a good MCI on the server. Tried to re-upload (e.g., a
    // clearer scan), the new upload failed before producing a fileUrl,
    // the client posted an entry with null fileUrl. Pre-Stage-B that
    // would have wiped the row's reference; Stage B preserves it.
    const existing = {
      mci_certificate: { status: "extracted", fileUrl: "https://s/old.pdf", extracted: { reg: "X" } },
    }
    const incoming = {
      mci_certificate: { status: "rejected", fileUrl: null, message: "Upload failed" },
    }
    const out = mergeDraftUploads(existing, incoming)
    expect(out.mci_certificate.fileUrl).toBe("https://s/old.pdf")
    expect(out.mci_certificate.extracted).toEqual({ reg: "X" })
  })

  it("multi-key incoming with mixed rules: one fresh, one null-fileUrl, one removal, one missing", () => {
    const existing = {
      mci: { status: "extracted", fileUrl: "https://s/mci_old.pdf" },
      pg: { status: "extracted", fileUrl: "https://s/pg.pdf" },
      profile: { status: "uploaded", fileUrl: "https://s/photo.png" },
      asi: { status: "extracted", fileUrl: "https://s/asi.pdf" },
    }
    const incoming = {
      mci: { status: "extracted", fileUrl: "https://s/mci_new.pdf" }, // rule 1: update
      pg: { status: "extracted", fileUrl: null },                       // rule 2: keep existing
      profile: null,                                                    // rule 5: remove
      // asi: missing                                                    // rule 3: keep existing
    }
    const out = mergeDraftUploads(existing, incoming)
    expect(out.mci.fileUrl).toBe("https://s/mci_new.pdf")
    expect(out.pg.fileUrl).toBe("https://s/pg.pdf")
    expect("profile" in out).toBe(false)
    expect(out.asi.fileUrl).toBe("https://s/asi.pdf")
  })
})
