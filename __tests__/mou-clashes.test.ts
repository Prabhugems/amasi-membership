import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"

const { mockClient } = vi.hoisted(() => ({
  mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null },
}))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => mockClient.current }))

import { getClashesForApplication } from "@/lib/mou/clashes"
import type { AcademicEventApplication } from "@/lib/mou/types"

const base = {
  application_type_id: "workshop",
  organizer_name: "Dr X",
  primary_institution: "Hospital",
  event_name: null,
  finalized_date: null,
  venue_city: null,
  venue_state: null,
}

const target = { ...base, id: "t", status: "approved", zone: "East", preferred_date_1: "2026-11-21", event_name: "Target" } as unknown as AcademicEventApplication

describe("getClashesForApplication", () => {
  beforeEach(() => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        { ...base, id: "t", status: "approved", zone: "East", preferred_date_1: "2026-11-21" },
        { ...base, id: "same", status: "approved", zone: "East", preferred_date_1: "2026-11-21", event_name: "Same day, same zone" },
        { ...base, id: "otherzone", status: "approved", zone: "West", preferred_date_1: "2026-11-21" },
        { ...base, id: "otherday", status: "approved", zone: "East", preferred_date_1: "2026-11-28" },
        { ...base, id: "cancelled", status: "cancelled", zone: "East", preferred_date_1: "2026-11-21" },
        { ...base, id: "pending", status: "submitted", zone: "East", preferred_date_1: "2026-11-21" },
      ],
      mou_calendar_entries: [
        { id: "e1", title: "Chapter conference", start_date: "2026-11-20", end_date: "2026-11-22", zone: "East", category: "conference" },
        { id: "e2", title: "Other zone camp", start_date: "2026-11-21", end_date: null, zone: "North", category: "camp" },
      ],
    })
  })

  it("returns same-zone overlapping approved MOUs and endorsed events, and nothing else", async () => {
    const clashes = await getClashesForApplication(target)
    expect(clashes.map((c) => c.title).sort()).toEqual(["Chapter conference", "Same day, same zone"])
  })

  it("returns nothing for an application with no zone or that is itself cancelled", async () => {
    expect(await getClashesForApplication({ ...target, zone: null } as AcademicEventApplication)).toEqual([])
    expect(await getClashesForApplication({ ...target, status: "cancelled" } as AcademicEventApplication)).toEqual([])
  })
})
