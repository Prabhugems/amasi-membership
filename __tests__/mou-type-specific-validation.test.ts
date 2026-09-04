// __tests__/mou-type-specific-validation.test.ts
import { describe, it, expect } from "vitest"
import { validateTypeSpecificFields } from "@/lib/mou/type-specific-validation"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig } from "@/lib/mou/event-type-config"

const rural = EVENT_TYPE_CONFIG.rural_program
const workshop = EVENT_TYPE_CONFIG.workshop
if (!isMouEventTypeConfig(rural) || !isMouEventTypeConfig(workshop)) {
  throw new Error("rural_program/workshop must be MouEventTypeConfig — check Task 3 landed first")
}

function futureDate(daysFromNow: number): string {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().slice(0, 10)
}

const validRuralBody = {
  preferred_date_1: futureDate(60),
  applicant_amasi_number: "12345",
  venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
  venue_setting: "Rural",
  institution_type: "own",
  joint_programme: false,
  faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
  agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
}

describe("validateTypeSpecificFields — rural_program", () => {
  it("passes a fully valid body", () => {
    expect(validateTypeSpecificFields(rural, validRuralBody)).toBeNull()
  })

  it("requires applicant_amasi_number (optional for fmas/mmas/dmas/slcp, required here)", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, applicant_amasi_number: undefined })
    expect(result).toContain("AMASI membership number")
  })

  it("blocks Urban venue setting with the clause-4 message", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, venue_setting: "Urban" })
    expect(result).toContain("Clause 4")
    expect(result).toContain("rural setting")
  })

  it("rejects a preferred_date_1 less than 45 days out", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, preferred_date_1: futureDate(10) })
    expect(result).toContain("45 days")
  })

  it("requires venue fields (requiresVenue: true)", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, venue_name: undefined })
    expect(result).toBeTruthy()
  })

  it("requires at least 1 faculty row", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, faculty: [] })
    expect(result).toBeTruthy()
  })

  it("rejects more than 20 faculty rows", () => {
    const faculty = Array.from({ length: 21 }, (_, i) => ({ name: `Dr. ${i}`, amasi_membership_number: null, speciality: null, is_amasi_member: true }))
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, faculty })
    expect(result).toBeTruthy()
  })

  it("requires speciality for a non-AMASI-member faculty row", () => {
    const faculty = [{ name: "Dr. Guest", amasi_membership_number: null, speciality: null, is_amasi_member: false }]
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, faculty })
    expect(result).toContain("speciality")
  })

  it("rejects more than 10 partner associations", () => {
    const partner_associations = Array.from({ length: 11 }, (_, i) => ({ name: `Assoc ${i}`, consent_letter_url: "https://x/y.pdf" }))
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, joint_programme: true, partner_associations })
    expect(result).toBeTruthy()
  })

  it("requires at least 1 partner association when joint_programme is true", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, joint_programme: true, partner_associations: [] })
    expect(result).toBeTruthy()
  })

  it("requires the guest-institution consent upload when institution_type is guest", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, institution_type: "guest", consent_guest_institution_url: undefined })
    expect(result).toBeTruthy()
  })

  it("passes when institution_type is guest and the consent upload is present", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, institution_type: "guest", consent_guest_institution_url: "https://x/consent.pdf" })
    expect(result).toBeNull()
  })

  it("requires the private-institution brief upload when institution_type is private", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, institution_type: "private", brief_institution_url: undefined })
    expect(result).toBeTruthy()
  })

  it("rejects target_population longer than 500 characters", () => {
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, target_population: "x".repeat(501) })
    expect(result).toBeTruthy()
  })

  it("rejects when not every agreement clauseRef is present and truthy", () => {
    const { [rural.agreements[0].clauseRef]: _omit, ...incomplete } = validRuralBody.agreements
    const result = validateTypeSpecificFields(rural, { ...validRuralBody, agreements: incomplete })
    expect(result).toBeTruthy()
  })
})

const validWorkshopBody = {
  preferred_date_1: futureDate(60),
  applicant_amasi_number: "12345",
  venue_type: "Hotel", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
  event_subtype: "workshop",
  institution_type: "own",
  joint_programme: false,
  faculty_travel_mode: "reimburse",
  organised_by_state_chapter: false,
  small_state_exception_requested: false,
  faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
  agreements: Object.fromEntries(workshop.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
}

describe("validateTypeSpecificFields — workshop", () => {
  it("passes a fully valid body", () => {
    expect(validateTypeSpecificFields(workshop, validWorkshopBody)).toBeNull()
  })

  it("has no venue_setting field at all (not copied from rural)", () => {
    expect(workshop.typeSpecificFields.some((f) => f.key === "venue_setting")).toBe(false)
  })

  it("requires event_subtype", () => {
    const result = validateTypeSpecificFields(workshop, { ...validWorkshopBody, event_subtype: undefined })
    expect(result).toBeTruthy()
  })

  it("requires faculty_travel_mode", () => {
    const result = validateTypeSpecificFields(workshop, { ...validWorkshopBody, faculty_travel_mode: undefined })
    expect(result).toBeTruthy()
  })

  it("rejects the small-state exception when organised_by_state_chapter is false", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: false,
      venue_state: "Sikkim", small_state_faculty_count: 2,
    })
    expect(result).toContain("clause 17")
  })

  it("rejects the small-state exception when venue_state is not in the eligible list", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: true,
      venue_state: "Tamil Nadu", small_state_faculty_count: 2,
    })
    expect(result).toContain("clause 17")
  })

  it("rejects a small_state_faculty_count outside [2, 3]", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: true,
      venue_state: "Sikkim", small_state_faculty_count: 4,
    })
    expect(result).toContain("clause 17")
  })

  it("accepts a valid small-state exception request", () => {
    const result = validateTypeSpecificFields(workshop, {
      ...validWorkshopBody, small_state_exception_requested: true, organised_by_state_chapter: true,
      venue_state: "Sikkim", small_state_faculty_count: 3,
    })
    expect(result).toBeNull()
  })
})
