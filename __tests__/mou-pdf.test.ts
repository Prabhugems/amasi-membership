import { describe, it, expect } from "vitest"
import { generateMouPdf } from "@/lib/mou/mou-pdf"
import type { AcademicEventApplication } from "@/lib/mou/types"

const fakeApplication: AcademicEventApplication = {
  id: "app-1", application_type_id: "fmas", status: "approved",
  applicant_amasi_number: "12345", applicant_member_id: null,
  organizer_name: "Dr. Test Organizer", email: "test@example.com", phone_number: "9999999999",
  otp_verified_at: new Date().toISOString(), primary_institution: "Test Hospital",
  event_name: null, expected_participants: null, live_surgery_demo: null,
  preferred_date_1: "2026-12-01", preferred_date_2: null, finalized_date: "2026-12-01",
  venue_type: "Hospital", venue_name: "Test Hospital Auditorium", venue_address: "1 Test Road",
  venue_city: "Chennai", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India", zone: null,
  auditorium_hall_a: true, auditorium_hall_b: false, av_equipment: true, endotrainers: true,
  high_speed_internet: false, agree_terms: true, certify_accurate: true, authority_confirm: true,
  committee_member_photo_url: null, institution_photo_url: null,
  mou_generated_url: null, mou_version: 0, created_event_id: null,
  reviewed_by: "Dr. Biswarup Bose", reviewed_at: new Date().toISOString(),
  rejection_reason: null, admin_notes: null, published_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}

describe("generateMouPdf", () => {
  it("produces a non-empty PDF buffer", async () => {
    const buffer = await generateMouPdf(fakeApplication, "FMAS Course")
    expect(buffer.length).toBeGreaterThan(1000)
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF")
  })
})
