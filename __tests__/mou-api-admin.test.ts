import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn() }))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  listApplications: vi.fn(),
  getApplicationById: vi.fn(),
}))

const { remarksOrderMock } = vi.hoisted(() => ({
  remarksOrderMock: vi.fn().mockResolvedValue({ data: [], error: null }),
}))
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: remarksOrderMock,
        }),
      }),
    }),
  }),
}))

import { GET as listGET } from "@/app/api/admin/mou-applications/route"
import { GET as detailGET } from "@/app/api/admin/mou-applications/[id]/route"
import { getAdminSession } from "@/lib/auth"
import { listApplications, getApplicationById } from "@/lib/mou/supabase-helpers"

describe("GET /api/admin/mou-applications", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401s when there is no admin session", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null)
    const req = new NextRequest("https://test.local/api/admin/mou-applications")
    const res = await listGET(req)
    expect(res.status).toBe(401)
    expect(listApplications).not.toHaveBeenCalled()
  })

  it("returns the list when an admin session exists", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminSession).mockResolvedValue({ sub: "admin-1", role: "admin" } as any)
    vi.mocked(listApplications).mockResolvedValue({ rows: [], total: 0 })
    const req = new NextRequest("https://test.local/api/admin/mou-applications")
    const res = await listGET(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ status: true, rows: [], total: 0 })
  })

  it("passes type/status/limit/offset query params through to listApplications", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminSession).mockResolvedValue({ sub: "admin-1", role: "admin" } as any)
    vi.mocked(listApplications).mockResolvedValue({ rows: [], total: 0 })
    const req = new NextRequest("https://test.local/api/admin/mou-applications?type=fmas&status=approved&limit=10&offset=20")
    await listGET(req)
    expect(listApplications).toHaveBeenCalledWith({ type: "fmas", status: "approved", limit: 10, offset: 20 })
  })

  it("clamps an absurd or invalid limit/offset instead of trusting the raw query string", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminSession).mockResolvedValue({ sub: "admin-1", role: "admin" } as any)
    vi.mocked(listApplications).mockResolvedValue({ rows: [], total: 0 })
    const req = new NextRequest("https://test.local/api/admin/mou-applications?limit=999999999&offset=-5")
    await listGET(req)
    expect(listApplications).toHaveBeenCalledWith({ type: undefined, status: undefined, limit: 200, offset: 0 })
  })
})

describe("GET /api/admin/mou-applications/[id]", () => {
  beforeEach(() => vi.clearAllMocks())

  it("401s when there is no admin session", async () => {
    vi.mocked(getAdminSession).mockResolvedValue(null)
    const req = new Request("http://test/api/admin/mou-applications/app-1")
    const res = await detailGET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req as any,
      { params: Promise.resolve({ id: "app-1" }) },
    )
    expect(res.status).toBe(401)
    expect(getApplicationById).not.toHaveBeenCalled()
  })

  it("404s when the application does not exist", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminSession).mockResolvedValue({ sub: "admin-1", role: "admin" } as any)
    vi.mocked(getApplicationById).mockResolvedValue(null)
    const req = new Request("http://test/api/admin/mou-applications/app-1")
    const res = await detailGET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req as any,
      { params: Promise.resolve({ id: "app-1" }) },
    )
    expect(res.status).toBe(404)
  })

  it("returns the application with its remarks when found", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getAdminSession).mockResolvedValue({ sub: "admin-1", role: "admin" } as any)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getApplicationById).mockResolvedValue({ id: "app-1", status: "submitted" } as any)
    remarksOrderMock.mockResolvedValueOnce({ data: [{ id: "r1", body: "looks good" }], error: null })

    const req = new Request("http://test/api/admin/mou-applications/app-1")
    const res = await detailGET(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      req as any,
      { params: Promise.resolve({ id: "app-1" }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.status).toBe(true)
    expect(body.application).toEqual({ id: "app-1", status: "submitted" })
    expect(body.remarks).toEqual([{ id: "r1", body: "looks good" }])
  })
})
