import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"

const { mockClient } = vi.hoisted(() => ({ mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null } }))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => mockClient.current }))
vi.mock("@/lib/auth", () => ({ getAdminSession: vi.fn().mockResolvedValue({ email: "admin@example.com", name: "Admin" }) }))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getApplicationById: vi.fn(),
  getRoleAssignment: vi.fn().mockResolvedValue(null),
}))

import { POST } from "@/app/api/admin/mou-applications/[id]/retry-event/route"
import { getApplicationById } from "@/lib/mou/supabase-helpers"

function baseApplication(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    application_type_id: "workshop",
    status: "approved",
    event_routing: "amasi",
    created_event_id: null,
    organizer_name: "Dr. Test",
    email: "organizer@example.com",
    primary_institution: "Test Hospital",
    event_name: "Test Workshop",
    finalized_date: null,
    preferred_date_1: "2026-09-27",
    venue_name: null,
    venue_city: null,
    venue_state: null,
    venue_country: "India",
    ...overrides,
  }
}

describe("POST retry-event — idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication()],
      events: [],
      team_invitations: [],
      admin_audit_log: [],
    })
  })

  async function callRoute() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return POST({} as any, { params: Promise.resolve({ id: "app-1" }) })
  }

  it("creates exactly one event across two sequential calls (second call short-circuits)", async () => {
    // First call: the application still has no event.
    vi.mocked(getApplicationById).mockResolvedValueOnce(baseApplication() as never)
    const res1 = await callRoute()
    const json1 = await res1.json()
    expect(json1.status).toBe(true)
    expect(mockClient.current!._tables.get("events")).toHaveLength(1)
    const eventId = json1.eventId

    // Second call: a real second fetch would now see created_event_id set
    // (the first call's claim update persisted it) — the route's own
    // top-level guard must catch this before ever calling
    // createEventForApplication again.
    vi.mocked(getApplicationById).mockResolvedValueOnce(baseApplication({ created_event_id: eventId }) as never)
    const res2 = await callRoute()
    const json2 = await res2.json()

    expect(res2.status).toBe(400)
    expect(json2.status).toBe(false)
    expect(mockClient.current!._tables.get("events")).toHaveLength(1) // still exactly one
  })

  it("refuses to retry when routing is 'none'", async () => {
    vi.mocked(getApplicationById).mockResolvedValueOnce(baseApplication({ event_routing: "none" }) as never)
    const res = await callRoute()
    expect(res.status).toBe(400)
    expect(mockClient.current!._tables.get("events")).toHaveLength(0)
  })

  it("refuses to retry when an event already exists, without calling createEventForApplication again", async () => {
    vi.mocked(getApplicationById).mockResolvedValueOnce(baseApplication({ created_event_id: "evt-existing" }) as never)
    const res = await callRoute()
    expect(res.status).toBe(400)
    expect(mockClient.current!._tables.get("events")).toHaveLength(0)
  })

  it("invites the organiser once the event is created", async () => {
    vi.mocked(getApplicationById).mockResolvedValueOnce(baseApplication() as never)
    await callRoute()
    const invites = mockClient.current!._tables.get("team_invitations")!
    expect(invites).toHaveLength(1)
    expect(invites[0]).toMatchObject({ email: "organizer@example.com", role: "coordinator" })
  })
})
