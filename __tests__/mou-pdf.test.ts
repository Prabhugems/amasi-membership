import { describe, it, expect } from "vitest"
import zlib from "node:zlib"
import { generateMouPdf } from "@/lib/mou/mou-pdf"
import type { AcademicEventApplication } from "@/lib/mou/types"

function baseApplication(overrides: Partial<AcademicEventApplication>): AcademicEventApplication {
  return {
    id: "app-1",
    application_type_id: "fmas",
    status: "approved",
    applicant_amasi_number: "12345",
    applicant_member_id: null,
    organizer_name: "Dr. Test Organizer",
    email: "test@example.com",
    phone_number: "9999999999",
    otp_verified_at: new Date().toISOString(),
    primary_institution: "Test Hospital",
    event_name: null,
    expected_participants: null,
    live_surgery_demo: null,
    preferred_date_1: "2026-12-01",
    preferred_date_2: null,
    finalized_date: "2026-12-01",
    venue_type: "Hospital",
    venue_name: "Test Hospital Auditorium",
    venue_address: "1 Test Road",
    venue_city: "Chennai",
    venue_state: "Tamil Nadu",
    venue_zip: "600001",
    venue_country: "India",
    zone: null,
    auditorium_hall_a: true,
    auditorium_hall_b: false,
    av_equipment: true,
    endotrainers: true,
    high_speed_internet: false,
    agree_terms: true,
    certify_accurate: true,
    authority_confirm: true,
    committee_member_photo_url: null,
    institution_photo_url: null,
    amasi_year_of_joining: null,
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
    type_specific_data: {},
    mou_generated_url: null,
    mou_version: 0,
    created_event_id: null,
    reviewed_by: "Dr. Biswarup Bose",
    reviewed_at: new Date().toISOString(),
    rejection_reason: null,
    admin_notes: null,
    published_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

const fmasApplication = baseApplication({ application_type_id: "fmas" })
const slcpApplication = baseApplication({ application_type_id: "slcp" })
const workshopApplication = baseApplication({ application_type_id: "workshop" })

/**
 * @react-pdf/renderer's `renderToBuffer` compresses page content streams with
 * zlib deflate by default (pdfkit's `compress: true`), so the raw PDF buffer
 * is NOT a reliable place to substring-search for rendered text — the bytes
 * are gone behind FlateDecode. To actually prove real legal text landed in
 * the PDF (not just "a PDF was produced"), this helper:
 *
 *   1. Finds every `stream ... endstream` block in the raw buffer.
 *   2. Attempts zlib inflate on each (content streams are FlateDecode;
 *      non-stream blocks, e.g. embedded font binaries, simply fail to
 *      inflate and are skipped).
 *   3. Within each successfully-inflated content stream, finds every
 *      hex string literal (`<...>` inside Tj/TJ show-text operators) and
 *      decodes each hex byte pair back to its character. react-pdf/pdfkit
 *      renders Helvetica (a standard, non-subsetted PDF font) using
 *      WinAnsi-compatible single-byte codes that map 1:1 to the source
 *      ASCII text, so decoding the hex bytes reconstructs the literal
 *      characters that were rendered — verified against a known marker
 *      string during development (decoded output matched byte-for-byte).
 *
 * This is a purpose-built minimal PDF text extractor, not a generic parser:
 * it is sufficient to confirm known legal-text substrings are present, which
 * is exactly what these tests need.
 */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString("latin1")
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  const hexRe = /<([0-9a-fA-F\s]+)>/g
  let text = ""
  let streamMatch: RegExpExecArray | null

  while ((streamMatch = streamRe.exec(raw))) {
    let inflated: Buffer
    try {
      inflated = zlib.inflateSync(Buffer.from(streamMatch[1], "latin1"))
    } catch {
      continue // not a FlateDecode content stream (e.g. embedded font/image data)
    }
    const content = inflated.toString("latin1")
    let hexMatch: RegExpExecArray | null
    while ((hexMatch = hexRe.exec(content))) {
      const hex = hexMatch[1].replace(/\s/g, "")
      if (hex.length === 0 || hex.length % 2 !== 0) continue
      let decoded = ""
      for (let i = 0; i < hex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
      }
      text += decoded
    }
    text += " "
  }
  return text
}

describe("generateMouPdf", () => {
  it("produces a valid, non-trivial PDF for the College of MAS family (fmas)", async () => {
    const buffer = await generateMouPdf(fmasApplication, "FMAS Skill Course")
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
    expect(buffer.length).toBeGreaterThan(1000)

    const text = extractPdfText(buffer)
    expect(text).toContain("FMAS Skill Course")
    expect(text).toContain("COLLEGE OF AMASI")
    expect(text).toContain("Convenor")
    expect(text).toContain(fmasApplication.organizer_name)
    expect(text).toContain(`Application ID ${fmasApplication.id}`)
  })

  it("produces a valid, non-trivial PDF for the Article family (slcp)", async () => {
    const buffer = await generateMouPdf(slcpApplication, "AMASI Safe Laparoscopic Cholecystectomy")
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
    expect(buffer.length).toBeGreaterThan(1000)

    const text = extractPdfText(buffer)
    expect(text).toContain("ARTICLE 1: PURPOSE")
    expect(text).toContain("AMASI Safe Laparoscopic Cholecystectomy")
    expect(text).toContain(slcpApplication.organizer_name)
  })

  it("produces a valid, non-trivial PDF for the numbered-clause family (workshop)", async () => {
    const buffer = await generateMouPdf(workshopApplication, "Workshop/CME/Conference")
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
    expect(buffer.length).toBeGreaterThan(1000)

    const text = extractPdfText(buffer)
    expect(text).toContain("ORGANISING COMMITTEE OF WORKSHOP")
    expect(text).toContain("ASSOCIATION OF MINIMAL ACCESS SURGEONS OF INDIA")
    expect(text).toContain(workshopApplication.organizer_name)
  })

  it("falls back to a generic title for zonal_event when event_name/zone are unset", async () => {
    const zonalApplication = baseApplication({ application_type_id: "zonal_event", zone: null, event_name: null })
    const buffer = await generateMouPdf(zonalApplication, "Zonal Event")
    const text = extractPdfText(buffer)
    expect(text).toContain("AMASI Zonal Event")
  })

  it("incorporates zone and event_name into the zonal_event title when set", async () => {
    const zonalApplication = baseApplication({
      application_type_id: "zonal_event",
      zone: "South",
      event_name: "Kerala Update",
    })
    const buffer = await generateMouPdf(zonalApplication, "Zonal Event")
    const text = extractPdfText(buffer)
    expect(text).toContain("AMASI South Zone Event")
    expect(text).toContain("Kerala Update")
  })

  describe("Party 2 caption per Article-family type", () => {
    it("labels Party 2 as PROGRAMME ORGANIZER for slcp (not NEXTGEN ORGANIZER)", async () => {
      const buffer = await generateMouPdf(slcpApplication, "AMASI Safe Laparoscopic Cholecystectomy")
      const text = extractPdfText(buffer)
      expect(text).toContain("PROGRAMME ORGANIZER")
      expect(text).not.toContain("NEXTGEN ORGANIZER")
    })

    it("labels Party 2 as NEXTGEN ORGANIZER for nextgen (not PROGRAMME ORGANIZER)", async () => {
      const nextgenApplication = baseApplication({ application_type_id: "nextgen" })
      const buffer = await generateMouPdf(nextgenApplication, "AMASI NextGen")
      const text = extractPdfText(buffer)
      expect(text).toContain("NEXTGEN ORGANIZER")
      expect(text).not.toContain("PROGRAMME ORGANIZER")
    })

    it("labels Party 2 as PROGRAMME ORGANIZER for meet_the_master", async () => {
      const mtmApplication = baseApplication({ application_type_id: "meet_the_master" })
      const buffer = await generateMouPdf(mtmApplication, "AMASI Meet the Master")
      const text = extractPdfText(buffer)
      expect(text).toContain("PROGRAMME ORGANIZER")
      expect(text).not.toContain("NEXTGEN ORGANIZER")
    })

    it("labels Party 2 as PROGRAMME ORGANIZER for zonal_event", async () => {
      const zonalApplication = baseApplication({ application_type_id: "zonal_event" })
      const buffer = await generateMouPdf(zonalApplication, "Zonal Event")
      const text = extractPdfText(buffer)
      expect(text).toContain("PROGRAMME ORGANIZER")
      expect(text).not.toContain("NEXTGEN ORGANIZER")
    })
  })
})
