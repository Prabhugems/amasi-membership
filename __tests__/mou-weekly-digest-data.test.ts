import { describe, it, expect, vi } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"

const { mockClient } = vi.hoisted(() => ({ mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null } }))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => mockClient.current }))

import { buildMouDigestSections } from "@/lib/mou-weekly-digest"

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
function daysAgoISO(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

describe("buildMouDigestSections", () => {
  it("returns allEmpty when there's nothing pending in any section", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [],
      events: [],
    })
    const sections = await buildMouDigestSections()
    expect(sections.allEmpty).toBe(true)
    expect(sections.awaitingDecision).toHaveLength(0)
    expect(sections.approvedNoEvent).toHaveLength(0)
    expect(sections.upcomingEvents).toHaveLength(0)
    expect(sections.overdueReports).toHaveLength(0)
    expect(sections.awaitingReview).toHaveLength(0)
  })

  it("populates one row in each section for a seeded dataset", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        {
          id: "awaiting-1",
          application_type_id: "fmas",
          status: "submitted",
          organizer_name: "Dr. Waiting",
          created_at: daysAgoISO(3),
          event_routing: "college",
          created_event_id: null,
        },
        {
          id: "approved-no-event-1",
          application_type_id: "workshop",
          status: "approved",
          organizer_name: "Dr. NoEvent",
          created_at: daysAgoISO(1),
          event_routing: "amasi",
          created_event_id: null,
        },
        {
          id: "upcoming-1",
          application_type_id: "nextgen",
          status: "approved",
          organizer_name: "Dr. Upcoming",
          created_at: daysAgoISO(20),
          event_routing: "amasi",
          created_event_id: "evt-1",
        },
        {
          id: "overdue-1",
          application_type_id: "fmas",
          status: "approved",
          organizer_name: "Dr. Overdue",
          created_at: daysAgoISO(30),
          finalized_date: null,
          preferred_date_1: daysAgoISO(20).slice(0, 10),
          event_routing: "college",
          // Has an event already (the overdue report is about that event
          // having happened, not about event creation) — must NOT also be
          // null here, or this row would incorrectly double up as an
          // "approved, no event" row too.
          created_event_id: "evt-2",
          report_reminder_15_sent_at: daysAgoISO(5),
          report_submitted_at: null,
        },
        {
          id: "review-1",
          application_type_id: "slcp",
          status: "approved",
          organizer_name: "Dr. Submitted",
          created_at: daysAgoISO(25),
          event_routing: "amasi",
          // Same reasoning as overdue-1 above — must have an event already,
          // or this would double up as "approved, no event" too.
          created_event_id: "evt-3",
          report_status: "submitted",
          report_submitted_at: daysAgoISO(2),
        },
      ],
      events: [{ id: "evt-1", name: "32 NextGen", start_date: daysFromNow(3), status: "registration_open" }],
    })

    const sections = await buildMouDigestSections()
    expect(sections.allEmpty).toBe(false)

    expect(sections.awaitingDecision).toHaveLength(1)
    expect(sections.awaitingDecision[0]).toMatchObject({ id: "awaiting-1", daysWaiting: 3 })

    expect(sections.approvedNoEvent.map((r) => r.id)).toEqual(["approved-no-event-1"])

    expect(sections.upcomingEvents).toHaveLength(1)
    expect(sections.upcomingEvents[0]).toMatchObject({ eventId: "evt-1", applicationId: "upcoming-1" })

    expect(sections.overdueReports.map((r) => r.id)).toEqual(["overdue-1"])

    expect(sections.awaitingReview.map((r) => r.id)).toEqual(["review-1"])
  })

  it("excludes cancelled events from 'events this week and next'", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        {
          id: "app-1",
          application_type_id: "fmas",
          status: "approved",
          organizer_name: "Dr. X",
          created_at: daysAgoISO(1),
          event_routing: "none",
          created_event_id: "evt-1",
        },
      ],
      events: [{ id: "evt-1", name: "Cancelled event", start_date: daysFromNow(2), status: "cancelled" }],
    })
    const sections = await buildMouDigestSections()
    expect(sections.upcomingEvents).toHaveLength(0)
  })
})
