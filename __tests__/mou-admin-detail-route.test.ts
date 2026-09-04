import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn().mockResolvedValue({ id: "admin-1" }) }))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getApplicationById: vi.fn().mockResolvedValue({ id: "app-1", application_type_id: "rural_program" }),
}))

const maybeSingleMock = vi.fn()
const remarksOrderMock = vi.fn().mockResolvedValue({ data: [] })

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "mou_signatures") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }) }) }
      }
      return { select: () => ({ eq: () => ({ order: remarksOrderMock }) }) }
    },
  }),
}))

import { GET } from "@/app/api/admin/mou-applications/[id]/route"

describe("GET /api/admin/mou-applications/[id] — signature anomaly detection", () => {
  beforeEach(() => vi.clearAllMocks())

  it("includes hasSignature: true when a matching mou_signatures row exists", async () => {
    maybeSingleMock.mockResolvedValue({ data: { id: "sig-1" }, error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET({} as any, { params: Promise.resolve({ id: "app-1" }) })
    const body = await res.json()
    expect(body.hasSignature).toBe(true)
  })

  it("includes hasSignature: false (anomaly) when no matching row exists for a mou-framework type", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET({} as any, { params: Promise.resolve({ id: "app-1" }) })
    const body = await res.json()
    expect(body.hasSignature).toBe(false)
  })
})
