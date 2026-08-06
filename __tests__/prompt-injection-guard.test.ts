import { describe, it, expect } from "vitest"
import { buildPrompt } from "@/lib/document-extraction"

describe("prompt-injection guard", () => {
  const TYPES = ["mci_certificate","pg_degree_certificate","mbbs_degree_certificate","asi_member_certificate","letter_hod","active_license"]
  it.each(TYPES)("every prompt carries the untrusted-content rule (%s)", (t) => {
    const p = buildPrompt(t)
    expect(p).toContain("UNTRUSTED INPUT")
    expect(p).toContain("STEP 0 identity check")
  })
  it("unknown doc types still return falsy, so callers still gate correctly", () => {
    expect(buildPrompt("not_a_real_doc_type")).toBeFalsy()
  })
})
