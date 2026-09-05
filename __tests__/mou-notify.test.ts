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

import {
  sendApplicantConfirmation,
  sendOutcomeEmail,
  sendWhatsAppNudge,
  sendSecretaryApprovalRequest,
  sendFyiNotification,
} from "@/lib/mou/notify"
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
  amasi_year_of_joining: null, designation: null, proposed_registration_fee: null,
  programme_outline: null, institution_type: null, joint_programme: false,
  partner_associations: [], consent_guest_institution_url: null,
  brief_institution_url: null, faculty: [], agreements: null, type_specific_data: {},
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

describe("sendOutcomeEmail", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"
    sendMock.mockClear()
  })

  it("HTML-escapes the rejection reason passed explicitly before interpolating it into the outbound email", async () => {
    await sendOutcomeEmail(app, "FMAS Course", "rejected", `<script>alert("x")</script> & "quoted" 'reason'`)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("&amp;")
    expect(html).toContain("&quot;quoted&quot;")
    expect(html).toContain("&#39;reason&#39;")
  })

  it("uses the explicit rejectionReason parameter, not application.rejection_reason", async () => {
    // application.rejection_reason may be stale (fetched before the DB
    // write persisted the decision) — sendOutcomeEmail must ignore it and
    // use only what's passed in explicitly.
    const staleApplication = { ...app, rejection_reason: "STALE — should not appear in the email" }
    await sendOutcomeEmail(staleApplication, "FMAS Course", "rejected", "the real, current reason")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain("STALE")
    expect(html).toContain("the real, current reason")
  })

  it("omits the reason sentence when no rejectionReason is passed", async () => {
    await sendOutcomeEmail(app, "FMAS Course", "rejected")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain("Reason:")
  })

  it("includes a 'what happens next' contact line and the status-page link on rejection", async () => {
    await sendOutcomeEmail(app, "FMAS Course", "rejected", "not eligible")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("amasi.india@gmail.com")
    expect(html).toContain(`/mou/status/${app.id}`)
  })

  it("includes a 'what happens next' contact line and the status-page link on changes_requested", async () => {
    await sendOutcomeEmail(app, "FMAS Course", "changes_requested", "please fix X")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("amasi.india@gmail.com")
    expect(html).toContain(`/mou/status/${app.id}`)
  })

  it("includes the status-page link on approval too", async () => {
    await sendOutcomeEmail(app, "FMAS Course", "approved")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain(`/mou/status/${app.id}`)
  })

  it("HTML-escapes organizer_name", async () => {
    const malicious = { ...app, organizer_name: `<img src=x onerror=alert(1)>` }
    await sendOutcomeEmail(malicious, "FMAS Course", "approved")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain("<img src=x")
    expect(html).toContain("&lt;img")
  })
})

describe("HTML-injection guard on applicant-supplied fields across all outbound emails", () => {
  beforeEach(() => {
    process.env.RESEND_API_KEY = "test-key"
    sendMock.mockClear()
  })

  it("escapes organizer_name and primary_institution in sendApplicantConfirmation", async () => {
    const malicious = { ...app, organizer_name: `<script>alert(1)</script>` }
    await sendApplicantConfirmation(malicious)
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("escapes organizer_name and primary_institution in sendSecretaryApprovalRequest", async () => {
    const malicious = {
      ...app,
      organizer_name: `<a href="evil.com">click</a>`,
      primary_institution: `<script>alert(2)</script>`,
    }
    await sendSecretaryApprovalRequest(malicious, "FMAS Course", "sec@example.com", "https://example.com/link")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain(`<a href="evil.com">click</a>`)
    expect(html).not.toContain("<script>alert(2)</script>")
    expect(html).toContain("&lt;a href=&quot;evil.com&quot;&gt;click&lt;/a&gt;")
    expect(html).toContain("&lt;script&gt;")
  })

  it("escapes organizer_name in sendFyiNotification", async () => {
    const malicious = { ...app, organizer_name: `<script>alert(3)</script>` }
    await sendFyiNotification(malicious, "FMAS Course", "president@example.com", "president", "https://example.com/link")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain("<script>alert(3)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("tells the recipient which role they're being notified as (president)", async () => {
    await sendFyiNotification(app, "FMAS Course", "president@example.com", "president", "https://example.com/link")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("AMASI President")
  })

  it("tells the recipient which role they're being notified as (zone chair, mapped to a readable label)", async () => {
    await sendFyiNotification(app, "Rural Surgery Camp", "chair@example.com", "zone_chair_south", "https://example.com/link")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("South Zone Chair")
  })

  it("falls back to a readable slug for an unmapped role, still escaped", async () => {
    await sendFyiNotification(app, "FMAS Course", "someone@example.com", "zone_chair_<script>", "https://example.com/link")
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain("zone chair &lt;script&gt;")
    expect(html).not.toContain("<script>")
  })
})

describe("sendWhatsAppNudge", () => {
  it("does not throw when GallaBox is unconfigured (sendTemplate returns success:false)", async () => {
    sendTemplateMock.mockResolvedValueOnce({ success: false, error: "WhatsApp not configured" })
    await expect(sendWhatsAppNudge(app, "approved")).resolves.not.toThrow()
  })
})
