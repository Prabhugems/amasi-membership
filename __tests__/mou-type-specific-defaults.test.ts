// __tests__/mou-type-specific-defaults.test.ts
import { describe, it, expect } from "vitest"
import { defaultTypeSpecificValues } from "@/components/mou/type-specific-section"
import type { TypeSpecificFieldDef } from "@/lib/mou/event-type-config"

describe("defaultTypeSpecificValues", () => {
  it("defaults text/textarea/number fields to empty string", () => {
    const fields: TypeSpecificFieldDef[] = [
      { key: "a", kind: "text", label: "A" },
      { key: "b", kind: "number", label: "B" },
    ]
    expect(defaultTypeSpecificValues(fields)).toEqual({ a: "", b: "" })
  })

  it("defaults checkbox fields to false", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "c", kind: "checkbox", label: "C" }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ c: false })
  })

  it("defaults radio fields to empty string", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "d", kind: "radio", label: "D", options: [] }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ d: "" })
  })

  it("defaults faculty-rows to an empty array under key 'faculty'", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "faculty", kind: "faculty-rows", minRows: 1, maxRows: 20 }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ faculty: [] })
  })

  it("defaults association-rows to an empty array under key 'partner_associations'", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "partner_associations", kind: "association-rows", maxRows: 10 }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ partner_associations: [] })
  })

  it("defaults conditional-upload to an empty string under '<docType>_url'", () => {
    const fields: TypeSpecificFieldDef[] = [{ key: "x", kind: "conditional-upload", docType: "consent_guest_institution", label: "X", requiredWhen: { field: "institution_type", equals: "guest" } }]
    expect(defaultTypeSpecificValues(fields)).toEqual({ consent_guest_institution_url: "" })
  })

  it("defaults facilities-group items individually (checkbox->false, number->'')", () => {
    const fields: TypeSpecificFieldDef[] = [
      { key: "facilities", kind: "facilities-group", items: [{ key: "hall_a", kind: "checkbox", label: "Hall A" }, { key: "beds", kind: "number", label: "Beds" }] },
    ]
    expect(defaultTypeSpecificValues(fields)).toEqual({ facilities: { hall_a: false, beds: "" } })
  })
})
