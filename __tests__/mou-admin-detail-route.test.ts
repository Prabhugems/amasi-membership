import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn().mockResolvedValue({ id: "admin-1" }) }))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getApplicationById: vi.fn().mockResolvedValue({ id: "app-1", application_type_id: "rural_program" }),
}))

const maybeSingleMock = vi.fn()
const remarksOrderMock = vi.fn().mockResolvedValue({ data: [] })

const orderLimitMock = vi.fn()

vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "mou_signatures") {
        // Fix 3: no longer .eq("mou_version", typeConfig.mouVersion) — the
        // lookup must find the actual signed row regardless of the current
        // config's version, so it's .eq(application_id).order(mou_version
        // desc).limit(1).maybeSingle().
        return { select: () => ({ eq: () => ({ order: orderLimitMock }) }) }
      }
      return { select: () => ({ eq: () => ({ order: remarksOrderMock }) }) }
    },
  }),
}))

import { GET } from "@/app/api/admin/mou-applications/[id]/route"

describe("GET /api/admin/mou-applications/[id] — signature anomaly detection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    orderLimitMock.mockReturnValue({ limit: () => ({ maybeSingle: maybeSingleMock }) })
  })

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

  it("includes hasSignature: null (not a false anomaly) when the query itself fails, e.g. table missing pre-migration (Fix 4)", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: "relation \"mou_signatures\" does not exist" } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = await GET({} as any, { params: Promise.resolve({ id: "app-1" }) })
    const body = await res.json()
    expect(body.hasSignature).toBeNull()
  })
})
