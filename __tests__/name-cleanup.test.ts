import { describe, it, expect } from "vitest"
import { cleanMemberName } from "@/lib/name-cleanup"

const row = (name: string, first: string | null, middle: string | null, last: string | null) => ({
  name, first_name: first, middle_name: middle, last_name: last,
})

describe("cleanMemberName — fixes", () => {
  it("repairs the #19208 case: OCR-split word, double space, ALL CAPS", () => {
    const fix = cleanMemberName(row("MURTHY SANTHOSH SANTHOSH  REDDY", "MURTHY", "SANTHOSH", "SANTHOSH  REDDY"))
    expect(fix?.patch).toEqual({
      name: "Murthy Santhosh Reddy",
      first_name: "Murthy",
      middle_name: null,
      last_name: "Santhosh Reddy",
    })
    expect(fix?.reasons.sort()).toEqual(["caps", "duplicate-word", "whitespace"])
  })

  it("drops a middle name that repeats the last name", () => {
    expect(cleanMemberName(row("Sunil Patil Patil", "Sunil", "Patil", "Patil"))?.patch).toEqual({
      name: "Sunil Patil", middle_name: null,
    })
  })

  it("drops a middle name that repeats the first name", () => {
    expect(cleanMemberName(row("Chathuranga Chathuranga Kepprtiyagama", "Chathuranga", "Chathuranga", "Kepprtiyagama"))?.patch).toEqual({
      name: "Chathuranga Kepprtiyagama", middle_name: null,
    })
  })

  it("collapses double spaces and trailing whitespace", () => {
    expect(cleanMemberName(row("Simran  Kaur", "Simran", null, "Kaur"))?.patch).toEqual({ name: "Simran Kaur" })
    expect(cleanMemberName(row("Shikha Gupta ", "Shikha", null, "Gupta "))?.patch).toEqual({ name: "Shikha Gupta", last_name: "Gupta" })
  })

  it("title-cases only the upper-case tokens of a mixed-case name", () => {
    expect(cleanMemberName(row("SMITA Sheth GHATAK", "SMITA", "Sheth", "GHATAK"))?.patch).toEqual({
      name: "Smita Sheth Ghatak", first_name: "Smita", last_name: "Ghatak",
    })
  })
})

describe("cleanMemberName — leaves legitimate names alone", () => {
  it.each([
    ["Ramesh S. S.", "Ramesh", "S.", "S."],
    ["Kannan R R", "Kannan", "R", "R"],
    ["K. K. Dhanani", "K.", null, "Dhanani"],
    ["Nyi Nyi Tun", "Nyi", null, "Tun"],
    ["Prabhu B", "Prabhu", null, "B"],
  ])("%s", (name, f, m, l) => {
    expect(cleanMemberName(row(name, f, m, l))).toBeNull()
  })

  it("does not touch first == last with no middle (manual review)", () => {
    expect(cleanMemberName(row("Kishor Kishor", "Kishor", null, "Kishor"))).toBeNull()
  })

  it("does not restructure fields when `name` differs from their join", () => {
    expect(cleanMemberName(row("Chathuranga Chathuranga Kepprtiyagama", "Chathuranga", null, "Kepprtiyagama"))).toBeNull()
  })

  it("keeps initials, roman numerals and short upper-case tokens", () => {
    expect(cleanMemberName(row("MD Hamim Alam", "MD", "Hamim", "Alam"))).toBeNull()
    expect(cleanMemberName(row("John Smith III", "John", "Smith", "III"))).toBeNull()
  })

  it("is idempotent", () => {
    const first = cleanMemberName(row("MURTHY SANTHOSH SANTHOSH  REDDY", "MURTHY", "SANTHOSH", "SANTHOSH  REDDY"))!
    const again = cleanMemberName({
      name: first.patch.name!, first_name: first.patch.first_name!, middle_name: first.patch.middle_name ?? null, last_name: first.patch.last_name!,
    })
    expect(again).toBeNull()
  })
})
