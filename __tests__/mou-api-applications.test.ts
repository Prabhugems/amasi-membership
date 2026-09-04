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

import { POST } from "@/app/api/mou/applications/route"
import { createApplication, getRoleAssignment } from "@/lib/mou/supabase-helpers"

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
})
