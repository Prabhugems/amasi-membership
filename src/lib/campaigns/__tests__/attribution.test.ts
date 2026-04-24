import { describe, it, expect } from "vitest"
import { pickRecipientToCredit } from "../attribution"

describe("pickRecipientToCredit", () => {
  it("picks the most recent recipient whose sent_at < at and target_fields overlap", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "r-old", sent_at: "2026-04-20T10:00:00Z", target_fields: ["pg_degree"] },
        { id: "r-mid", sent_at: "2026-04-22T10:00:00Z", target_fields: ["pg_degree", "profile_photo"] },
        { id: "r-new-future", sent_at: "2026-04-25T10:00:00Z", target_fields: ["pg_degree"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick?.id).toBe("r-mid")
  })

  it("returns null when no recipient's target_fields overlap", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "r1", sent_at: "2026-04-20T10:00:00Z", target_fields: ["profile_photo"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick).toBeNull()
  })

  it("strictly-after: sent_at equal to at is excluded", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "r1", sent_at: "2026-04-23T09:00:00Z", target_fields: ["pg_degree"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick).toBeNull()
  })

  it("tiebreak: identical sent_at picks the recipient with the lower id (ascending)", () => {
    const pick = pickRecipientToCredit({
      candidates: [
        { id: "b-zzz", sent_at: "2026-04-22T10:00:00Z", target_fields: ["pg_degree"] },
        { id: "a-aaa", sent_at: "2026-04-22T10:00:00Z", target_fields: ["pg_degree"] },
      ],
      changedFields: ["pg_degree"],
      at: "2026-04-23T09:00:00Z",
    })
    expect(pick?.id).toBe("a-aaa")
  })
})
