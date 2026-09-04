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
})
