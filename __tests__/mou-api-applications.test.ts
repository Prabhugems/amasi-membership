import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: "otp-1" } }),
                }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))
vi.mock("@/lib/mou/otp", () => ({ verifyMouOtp: vi.fn() }))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  createApplication: vi.fn(),
  getRoleAssignment: vi.fn(),
  getApplicationById: vi.fn(),
}))
vi.mock("@/lib/mou/approval-token", () => ({ createApprovalToken: vi.fn().mockResolvedValue("raw-token") }))
vi.mock("@/lib/mou/notify", () => ({
  sendApplicantConfirmation: vi.fn(),
  sendSecretaryApprovalRequest: vi.fn(),
  sendFyiNotification: vi.fn(),
}))
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))
vi.mock("@/lib/mou/mou-signature", () => ({
  computeMouHash: vi.fn().mockReturnValue("fake-hash"),
  createMouSignature: vi.fn().mockResolvedValue({ id: "sig-1" }),
}))
// The real checkRateLimit falls back to an in-memory Map keyed by IP that is
// module-level (not reset by vi.clearAllMocks), so every POST in this file
// — across every test — would otherwise share one bucket and this file now
// makes more than the 10-per-hour default cap. Mock it out so this file
// tests submission behavior, not rate-limit exhaustion.
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: 0 }),
}))

import { POST } from "@/app/api/mou/applications/route"
import { createApplication, getRoleAssignment } from "@/lib/mou/supabase-helpers"
import { createApprovalToken } from "@/lib/mou/approval-token"
import { sendApplicantConfirmation, sendSecretaryApprovalRequest } from "@/lib/mou/notify"
import * as Sentry from "@sentry/nextjs"

const validBody = {
  application_type_id: "fmas",
  organizer_name: "Dr. Test",
  email: "organizer@example.com",
  phone_number: "9999999999",
  primary_institution: "Test Hospital",
  preferred_date_1: "2026-12-01",
  zone: "South",
  agree_terms: true,
  certify_accurate: true,
  authority_confirm: true,
}

describe("POST /api/mou/applications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createApplication).mockResolvedValue({ id: "app-1", ...validBody } as any)
    vi.mocked(getRoleAssignment).mockResolvedValue({ name: "Dr. Biswarup Bose", email: "sec@example.com", phone: null })
  })

  it("rejects when the required agreement checkboxes are missing", async () => {
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify({ ...validBody, agree_terms: false }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(400)
  })

  it("creates the application when the payload is valid", async () => {
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify(validBody),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe(true)
    expect(body.applicationId).toBe("app-1")
    expect(createApplication).toHaveBeenCalledTimes(1)
  })

  it("strips forbidden fields (applicant_member_id, status, reviewed_by, id) before calling createApplication", async () => {
    const maliciousBody = {
      ...validBody,
      applicant_member_id: "victim-member-uuid",
      status: "approved",
      reviewed_by: "attacker-controlled",
      reviewed_at: "2020-01-01T00:00:00.000Z",
      admin_notes: "injected",
      id: "attacker-chosen-id",
    }
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify(maliciousBody),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)

    expect(createApplication).toHaveBeenCalledTimes(1)
    const calledWith = vi.mocked(createApplication).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(calledWith.applicant_member_id).toBeUndefined()
    expect(calledWith.status).toBeUndefined()
    expect(calledWith.reviewed_by).toBeUndefined()
    expect(calledWith.reviewed_at).toBeUndefined()
    expect(calledWith.admin_notes).toBeUndefined()
    expect(calledWith.id).toBeUndefined()
    // Legitimate fields still pass through.
    expect(calledWith.organizer_name).toBe("Dr. Test")
    expect(calledWith.email).toBe("organizer@example.com")
  })

  it("still returns 200 with the applicationId when the applicant confirmation email fails", async () => {
    vi.mocked(sendApplicantConfirmation).mockRejectedValueOnce(new Error("RESEND_API_KEY not configured"))
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify(validBody),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe(true)
    expect(body.applicationId).toBe("app-1")
    expect(Sentry.captureException).toHaveBeenCalled()
  })

  it("still returns 200 with the applicationId when the Hon. Secretary token/notification fails (Resend network blip)", async () => {
    vi.mocked(createApprovalToken).mockRejectedValueOnce(new Error("network blip"))
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify(validBody),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe(true)
    expect(body.applicationId).toBe("app-1")
    expect(Sentry.captureException).toHaveBeenCalled()
  })

  it("still notifies the president even when the secretary notification failed", async () => {
    vi.mocked(sendSecretaryApprovalRequest).mockRejectedValueOnce(new Error("secretary email failed"))
    vi.mocked(getRoleAssignment).mockImplementation(async (role: string) => {
      if (role === "hon_secretary") return { name: "Dr. Biswarup Bose", email: "sec@example.com", phone: null }
      if (role === "president") return { name: "Dr. President", email: "president@example.com", phone: null }
      return null
    })
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify(validBody),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    // createApprovalToken called once for secretary (which failed inside the
    // try block) and once for president (independent, still ran).
    expect(createApprovalToken).toHaveBeenCalledWith("app-1", "president", false)
  })

  it("rejects a rural_program submission missing type-specific required fields", async () => {
    const req = new Request("http://test/api/mou/applications", {
      method: "POST",
      body: JSON.stringify({
        ...validBody,
        application_type_id: "rural_program",
        // no venue_*, venue_setting, institution_type, faculty, agreements — all required for this type
      }),
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    expect(createApplication).not.toHaveBeenCalled()
  })

  it("calls createMouSignature after a successful rural_program submission", async () => {
    const { createMouSignature } = await import("@/lib/mou/mou-signature")
    const { EVENT_TYPE_CONFIG } = await import("@/lib/mou/event-type-config")
    const rural = EVENT_TYPE_CONFIG.rural_program as import("@/lib/mou/event-type-config").MouEventTypeConfig
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })()
    const ruralBody = {
      ...validBody,
      application_type_id: "rural_program",
      preferred_date_1: futureDate,
      applicant_amasi_number: "12345",
      venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
      venue_setting: "Rural",
      institution_type: "own",
      joint_programme: false,
      faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
      agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(ruralBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(createMouSignature).toHaveBeenCalledWith(
      expect.objectContaining({ applicationId: "app-1", signatoryEmail: "organizer@example.com" })
    )
  })

  it("buckets type-specific-only fields into type_specific_data, keeps shared-column fields at the top level (plan-review fix)", async () => {
    const { EVENT_TYPE_CONFIG } = await import("@/lib/mou/event-type-config")
    const rural = EVENT_TYPE_CONFIG.rural_program as import("@/lib/mou/event-type-config").MouEventTypeConfig
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })()
    const ruralBody = {
      ...validBody, application_type_id: "rural_program", preferred_date_1: futureDate,
      applicant_amasi_number: "12345",
      venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
      venue_setting: "Rural", institution_type: "own", joint_programme: false,
      expected_beneficiaries: 40, financial_assistance_requested: true,
      faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
      agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(ruralBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await POST(req as any)
    const insertedBody = vi.mocked(createApplication).mock.calls[0][0]
    // venue_setting/expected_beneficiaries/financial_assistance_requested have
    // NO column of their own — they must land in type_specific_data.
    expect(insertedBody.type_specific_data).toMatchObject({
      venue_setting: "Rural", expected_beneficiaries: 40, financial_assistance_requested: true, _v: 1,
    })
    // institution_type DOES have a real column — it must NOT be duplicated
    // inside type_specific_data.
    expect(insertedBody.institution_type).toBe("own")
    expect((insertedBody.type_specific_data as Record<string, unknown>).institution_type).toBeUndefined()
  })

  it("returns 500 (not a silent swallow) when createMouSignature fails for a mou-framework type", async () => {
    const { createMouSignature } = await import("@/lib/mou/mou-signature")
    vi.mocked(createMouSignature).mockRejectedValueOnce(new Error("insert failed"))
    const { EVENT_TYPE_CONFIG } = await import("@/lib/mou/event-type-config")
    const rural = EVENT_TYPE_CONFIG.rural_program as import("@/lib/mou/event-type-config").MouEventTypeConfig
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })()
    const ruralBody = {
      ...validBody, application_type_id: "rural_program", preferred_date_1: futureDate,
      applicant_amasi_number: "12345",
      venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
      venue_setting: "Rural", institution_type: "own", joint_programme: false,
      faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
      agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(ruralBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(500)
  })

  it("does not call validateTypeSpecificFields/createMouSignature for the other 7 unchanged types (fmas)", async () => {
    const { createMouSignature } = await import("@/lib/mou/mou-signature")
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(validBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    expect(createMouSignature).not.toHaveBeenCalled()
  })

  it("coerces blank amasi_year_of_joining/proposed_registration_fee to undefined instead of crashing on '' (Fix 1)", async () => {
    const { EVENT_TYPE_CONFIG } = await import("@/lib/mou/event-type-config")
    const rural = EVENT_TYPE_CONFIG.rural_program as import("@/lib/mou/event-type-config").MouEventTypeConfig
    const futureDate = (() => { const d = new Date(); d.setDate(d.getDate() + 60); return d.toISOString().slice(0, 10) })()
    const ruralBody = {
      ...validBody, application_type_id: "rural_program", preferred_date_1: futureDate,
      applicant_amasi_number: "12345",
      venue_type: "Hospital", venue_name: "X", venue_address: "Y", venue_city: "Z", venue_state: "Tamil Nadu", venue_zip: "600001", venue_country: "India",
      venue_setting: "Rural", institution_type: "own", joint_programme: false,
      // The form's <Input type="number"> writes back "" when left blank —
      // both fields are optional typeSpecificFields entries.
      amasi_year_of_joining: "",
      proposed_registration_fee: "",
      faculty: [{ name: "Dr. A", amasi_membership_number: "123", speciality: null, is_amasi_member: true }],
      agreements: Object.fromEntries(rural.agreements.map((a) => [a.clauseRef, new Date().toISOString()])),
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(ruralBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const insertedBody = vi.mocked(createApplication).mock.calls[0][0] as unknown as Record<string, unknown>
    expect(insertedBody.amasi_year_of_joining).toBeUndefined()
    expect(insertedBody.proposed_registration_fee).toBeUndefined()
  })

  it("returns 400 (not an unhandled throw) when createApplication itself fails (Fix 1 defense in depth)", async () => {
    vi.mocked(createApplication).mockRejectedValueOnce(new Error("22P02 invalid input syntax"))
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(validBody) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.status).toBe(false)
  })

  it("does not include the 11 mou-framework-only fields for the other 7 event types (Fix 8)", async () => {
    const maliciousExtras = {
      ...validBody,
      amasi_year_of_joining: 2020,
      designation: "Professor",
      proposed_registration_fee: 500,
      programme_outline: "outline",
      institution_type: "own",
      joint_programme: true,
      partner_associations: [{ name: "Assoc", consent_letter_url: null }],
      consent_guest_institution_url: "https://x/y.pdf",
      brief_institution_url: "https://x/z.pdf",
      faculty: [{ name: "Dr. A", amasi_membership_number: null, speciality: null, is_amasi_member: true }],
      agreements: { "1": "2026-01-01T00:00:00.000Z" },
    }
    const req = new Request("http://test/api/mou/applications", { method: "POST", body: JSON.stringify(maliciousExtras) })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const insertedBody = vi.mocked(createApplication).mock.calls[0][0] as unknown as Record<string, unknown>
    for (const key of [
      "amasi_year_of_joining", "designation", "proposed_registration_fee", "programme_outline",
      "institution_type", "joint_programme", "partner_associations", "consent_guest_institution_url",
      "brief_institution_url", "faculty", "agreements",
    ]) {
      expect(insertedBody[key]).toBeUndefined()
    }
  })
})
