import { describe, it, expect, vi, beforeEach } from "vitest"

const { sendMock, sendTemplateMock } = vi.hoisted(() => {
  return {
    sendMock: vi.fn().mockResolvedValue({ data: { id: "email-1" }, error: null }),
    sendTemplateMock: vi.fn().mockResolvedValue({ success: true }),
  }
})

vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))

vi.mock("@/lib/whatsapp", () => ({
  sendTemplate: sendTemplateMock,
}))

import { sendApplicantConfirmation, sendWhatsAppNudge } from "@/lib/mou/notify"
import type { AcademicEventApplication } from "@/lib/mou/types"

const app: AcademicEventApplication = {
  id: "app-1", application_type_id: "fmas", status: "submitted",
  applicant_amasi_number: null, applicant_member_id: null,
  organizer_name: "Dr. Test", email: "organizer@example.com", phone_number: "9999999999",
  otp_verified_at: new Date().toISOString(), primary_institution: "Test Hospital",
  event_name: null, expected_participants: null, live_surgery_demo: null,
  preferred_date_1: "2026-12-01", preferred_date_2: null, finalized_date: null,
  venue_type: null, venue_name: null, venue_address: null, venue_city: null,
  venue_state: null, venue_zip: null, venue_country: null, zone: null,
  auditorium_hall_a: false, auditorium_hall_b: false, av_equipment: false, endotrainers: false,
  high_speed_internet: false, agree_terms: true, certify_accurate: true, authority_confirm: true,
  committee_member_photo_url: null, institution_photo_url: null,
  mou_generated_url: null, mou_version: 0, created_event_id: null,
  reviewed_by: null, reviewed_at: null, rejection_reason: null, admin_notes: null, published_at: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
}

describe("sendApplicantConfirmation", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"
    sendMock.mockClear()
  })

  it("sends one email to the applicant", async () => {
    await sendApplicantConfirmation(app)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0].to).toBe("organizer@example.com")
  })
})

describe("sendWhatsAppNudge", () => {
  it("does not throw when GallaBox is unconfigured (sendTemplate returns success:false)", async () => {
    sendTemplateMock.mockResolvedValueOnce({ success: false, error: "WhatsApp not configured" })
    await expect(sendWhatsAppNudge(app, "approved")).resolves.not.toThrow()
  })
})
