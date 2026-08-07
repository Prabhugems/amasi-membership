/**
 * normalize-name regression tests.
 *
 * Backstop for the 2026-06-30 cleanup: 21 members had `middle_name = first_name`
 * (case-insensitive). MCI-cert OCR + manual form entry both produce this.
 * Badges rendered "Dr. Shivani Shivani Samaiya" because the badge generator
 * concatenates salutation + first + middle + last verbatim. Snapshot at
 * `members_middle_name_dup_2026_06_30_snapshot` (rollback path).
 *
 * If `normalizeMiddleName` ever stops returning null for a duplicate pair,
 * new bad rows will start landing in members.middle_name within hours.
 */
import { describe, it, expect } from "vitest"
import { normalizeMiddleName, buildFullName } from "@/lib/normalize-name"

describe("normalizeMiddleName", () => {
  it("returns null when middle is a case-insensitive duplicate of first", () => {
    expect(normalizeMiddleName("Shivani", "Shivani")).toBeNull()
    expect(normalizeMiddleName("SHIVANI", "shivani")).toBeNull()
    expect(normalizeMiddleName("anuj", "Anuj")).toBeNull()
    expect(normalizeMiddleName(" Hetvi ", "hetvi")).toBeNull()
  })

  it("returns null for empty / whitespace / nullish middle", () => {
    expect(normalizeMiddleName("Shivani", null)).toBeNull()
    expect(normalizeMiddleName("Shivani", undefined)).toBeNull()
    expect(normalizeMiddleName("Shivani", "")).toBeNull()
    expect(normalizeMiddleName("Shivani", "   ")).toBeNull()
  })

  it("returns the trimmed middle when it differs from first", () => {
    expect(normalizeMiddleName("Shivani", "Anand")).toBe("Anand")
    expect(normalizeMiddleName("Anuj", "  Kumar  ")).toBe("Kumar")
    expect(normalizeMiddleName("V", "V A")).toBe("V A") // first="V", middle="V A" — not a duplicate
  })

  it("does not collapse legitimate Indian initial pairs like V/V A", () => {
    // 123A1184 V V A Ch Sekhar Reddy — first and middle look similar but
    // aren't equal strings, so we must not strip either.
    expect(normalizeMiddleName("V", "V A")).toBe("V A")
  })

  it("treats missing firstName as a non-match (preserves middle)", () => {
    // Defensive — if firstName is null we don't have grounds to drop middle.
    expect(normalizeMiddleName(null, "Kumar")).toBe("Kumar")
    expect(normalizeMiddleName("", "Kumar")).toBe("Kumar")
  })
})

describe("buildFullName", () => {
  it("drops the duplicated middle when composing the display name", () => {
    expect(buildFullName("Shivani", "Shivani", "Samaiya")).toBe("Shivani Samaiya")
    expect(buildFullName("Hetvi", "hetvi", "Somaiya")).toBe("Hetvi Somaiya")
  })

  it("includes middle when distinct", () => {
    expect(buildFullName("Shivani", "Anand", "Samaiya")).toBe("Shivani Anand Samaiya")
  })

  it("handles missing parts without producing double spaces", () => {
    expect(buildFullName("Shivani", null, "Samaiya")).toBe("Shivani Samaiya")
    expect(buildFullName("Shivani", "", "Samaiya")).toBe("Shivani Samaiya")
    expect(buildFullName(null, null, "Samaiya")).toBe("Samaiya")
    expect(buildFullName("Shivani", null, null)).toBe("Shivani")
  })
})
