/**
 * AMASICON as an online MOU-framework event type.
 *
 * Pins the parts that would silently break the bid flow if drifted: the
 * config's clause array must be the exact PDF clause array (the signature
 * hash is computed over it), the 12-month lead-time rule from clause 41,
 * the required bid fields, and that the numbered-clause PDF family renders
 * it including the procedures appendix.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig, type MouEventTypeConfig } from "@/lib/mou/event-type-config"
import { AMASICON_CLAUSES, AMASICON_PROCEDURES, generateMouPdf } from "@/lib/mou/mou-pdf"
import { validateTypeSpecificFields } from "@/lib/mou/type-specific-validation"
import type { AcademicEventApplication } from "@/lib/mou/types"

const raw = EVENT_TYPE_CONFIG.amasicon
if (!isMouEventTypeConfig(raw)) throw new Error("amasicon must be a MouEventTypeConfig")
const amasicon: MouEventTypeConfig = raw

function daysFromNow(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const agreements: Record<string, string> = {}
  for (const a of amasicon.agreements) agreements[a.clauseRef] = new Date().toISOString()
  return {
    application_type_id: "amasicon",
    applicant_amasi_number: "18263",
    preferred_date_1: daysFromNow(400),
    amasi_year_of_joining: 2010,
    organizing_chairman: "Dr A",
    host_city: "Coimbatore",
    local_support: "Airport, 3,000 hotel rooms, teaching hospital backing",
    joint_programme: false,
    partner_associations: [],
    agreements,
    ...overrides,
  }
}

describe("amasicon event-type config", () => {
  it("uses the exported AMASICON clause array verbatim (signature hash input)", () => {
    expect(amasicon.mouClauses).toBe(AMASICON_CLAUSES)
    expect(AMASICON_CLAUSES).toHaveLength(41)
    expect(AMASICON_PROCEDURES.sections.map((s) => s.heading)).toEqual([
      "Pre-incorporation", "Post incorporation", "For finalisation of accounts", "End process",
    ])
  })

  it("requires a 12-month lead time with its own clause-41 message, no venue, and the zone field", () => {
    expect(amasicon.minLeadDays).toBe(365)
    expect(amasicon.leadTimeMessage).toMatch(/Clause 41/)
    expect(amasicon.requiresVenue).toBe(false)
    expect(amasicon.fields).toContain("zone")
    expect(amasicon.fields).toContain("amasi_membership_number")
    expect(amasicon.dateLabels?.primary).toMatch(/conference date/i)
  })

  it("has unique agreement clauseRefs, including the GBM bid pledge and clause 41", () => {
    const refs = amasicon.agreements.map((a) => a.clauseRef)
    expect(new Set(refs).size).toBe(refs.length)
    expect(refs).toContain("bid")
    expect(refs).toContain("41")
    expect(refs).toContain("37")
  })

  it("has no faculty rows (AMASI decides the programme) and no small-state exception", () => {
    expect(amasicon.typeSpecificFields.some((f) => f.kind === "faculty-rows")).toBe(false)
    expect(amasicon.smallStateException).toBeUndefined()
    expect(amasicon.eventSubtypeWarning).toBeUndefined()
  })

  it("is registered in sql/041 with the same id", () => {
    const sql = readFileSync(path.join(process.cwd(), "sql/041_amasicon_event_type.sql"), "utf-8")
    expect(sql).toMatch(/insert into public\.academic_event_types/)
    expect(sql).toContain("'amasicon'")
  })
})

describe("validateTypeSpecificFields — amasicon", () => {
  it("passes a fully valid bid", () => {
    expect(validateTypeSpecificFields(amasicon, validBody())).toBeNull()
  })

  it("rejects a conference date less than 365 days out with the clause-41 message", () => {
    const msg = validateTypeSpecificFields(amasicon, validBody({ preferred_date_1: daysFromNow(200) }))
    expect(msg).toMatch(/Clause 41/)
  })

  it("requires the AMASI membership number, organizing chairman, host city and local-support rationale", () => {
    expect(validateTypeSpecificFields(amasicon, validBody({ applicant_amasi_number: "" }))).toMatch(/membership number/)
    expect(validateTypeSpecificFields(amasicon, validBody({ organizing_chairman: "" }))).toMatch(/Organizing Chairman/)
    expect(validateTypeSpecificFields(amasicon, validBody({ host_city: "" }))).toMatch(/host city/)
    expect(validateTypeSpecificFields(amasicon, validBody({ local_support: "" }))).toMatch(/Why this city/)
  })

  it("does not require venue fields (bids are placed before the venue is fixed)", () => {
    expect(validateTypeSpecificFields(amasicon, validBody({ venue_name: "", venue_city: "" }))).toBeNull()
  })

  it("requires a partner association when the bid is a joint programme (clause 4)", () => {
    expect(validateTypeSpecificFields(amasicon, validBody({ joint_programme: true }))).toMatch(/partner association/)
  })

  it("rejects when any agreement is missing", () => {
    const body = validBody()
    const agreements = { ...(body.agreements as Record<string, string>) }
    delete agreements["41"]
    expect(validateTypeSpecificFields(amasicon, { ...body, agreements })).toMatch(/clause 41/)
  })
})

describe("generateMouPdf — amasicon", () => {
  const application = {
    id: "00000000-0000-4000-8000-000000000001",
    application_type_id: "amasicon",
    status: "approved",
    applicant_amasi_number: "18263",
    applicant_member_id: null,
    organizer_name: "Dr Bid Secretary",
    email: "bid@example.org",
    phone_number: "9999999999",
    otp_verified_at: "2026-09-10T00:00:00.000Z",
    primary_institution: "Test Hospital",
    event_name: "AMASICON 2028",
    expected_participants: "1500",
    live_surgery_demo: null,
    preferred_date_1: "2028-09-14",
    preferred_date_2: null,
    finalized_date: null,
    venue_type: null,
    venue_name: null,
    venue_address: null,
    venue_city: "Coimbatore",
    venue_state: "Tamil Nadu",
    venue_zip: null,
    venue_country: "India",
    zone: "South",
    auditorium_hall_a: false,
    auditorium_hall_b: false,
    av_equipment: false,
    endotrainers: false,
    high_speed_internet: false,
    agree_terms: true,
    certify_accurate: true,
    authority_confirm: true,
    committee_member_photo_url: null,
    institution_photo_url: null,
    amasi_year_of_joining: 2010,
    designation: null,
    proposed_registration_fee: null,
    programme_outline: null,
    institution_type: null,
    joint_programme: false,
    partner_associations: [],
    consent_guest_institution_url: null,
    brief_institution_url: null,
    faculty: [],
    agreements: null,
    type_specific_data: { _v: 1, organizing_chairman: "Dr A", host_city: "Coimbatore" },
    mou_generated_url: null,
    mou_version: 0,
    created_event_id: null,
    reviewed_by: "secretary@example.org",
    reviewed_at: "2026-09-11T00:00:00.000Z",
    rejection_reason: null,
    admin_notes: null,
    published_at: null,
    report_documents: [],
    report_notes: null,
    report_submitted_at: null,
    report_reminder_7_sent_at: null,
    report_reminder_15_sent_at: null,
    report_escalation_sent_at: null,
    registration_required: null,
    event_routing: "amasi",
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:00:00.000Z",
  } satisfies AcademicEventApplication

  it("renders a numbered-clause PDF with the organizer name and the procedures appendix", async () => {
    const buffer = await generateMouPdf(application, "AMASICON — Annual Conference")
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
    expect(buffer.length).toBeGreaterThan(20_000)
  })
})
