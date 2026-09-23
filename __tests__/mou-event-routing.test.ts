import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"
import type { AcademicEventApplication, ApplicationTypeId } from "@/lib/mou/types"

const { mockClient } = vi.hoisted(() => ({ mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null } }))
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => mockClient.current,
}))

import { createEventForApplication, isEventRoutingLocked, syncEventRegistration, getDefaultEventRouting, EVENT_CREATED_BY_USER_ID } from "@/lib/mou/event-routing"

function baseApplication(overrides: Partial<AcademicEventApplication> = {}): AcademicEventApplication {
  return {
    id: "app-1",
    application_type_id: "fmas",
    status: "approved",
    applicant_amasi_number: null,
    applicant_member_id: null,
    organizer_name: "Dr. Test",
    email: "test@example.com",
    phone_number: "9999999999",
    otp_verified_at: null,
    primary_institution: "Test Hospital",
    event_name: null,
    expected_participants: null,
    live_surgery_demo: null,
    preferred_date_1: "2026-12-01",
    preferred_date_2: null,
    finalized_date: null,
    venue_type: null,
    venue_name: "Test Auditorium",
    venue_address: null,
    venue_city: "Chennai",
    venue_state: "Tamil Nadu",
    venue_zip: null,
    venue_country: "India",
    zone: null,
    auditorium_hall_a: false,
    auditorium_hall_b: false,
    av_equipment: false,
    endotrainers: false,
    high_speed_internet: false,
    agree_terms: true,
    certify_accurate: true,
    authority_confirm: true,
    committee_member_photo_url: null,
    institution_photo_url: null,
    amasi_year_of_joining: null,
    designation: null,
    proposed_registration_fee: null,
    programme_outline: null,
    institution_type: null,
    joint_programme: false,
    partner_associations: [],
    consent_guest_institution_url: null,
    brief_institution_url: null,
    faculty: [],
    agreements: null,
    type_specific_data: {},
    mou_generated_url: null,
    mou_version: 0,
    created_event_id: null,
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
    admin_notes: null,
    published_at: null,
    report_documents: [],
    report_notes: null,
    report_submitted_at: null,
    report_reminder_7_sent_at: null,
    report_reminder_15_sent_at: null,
    report_escalation_sent_at: null,
    report_status: null,
    report_reviewed_by: null,
    report_reviewed_at: null,
    report_return_note: null,
    registration_required: null,
    event_routing: "college",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

describe("createEventForApplication", () => {
  beforeEach(() => {
    mockClient.current = createMockSupabase({ events: [] })
  })

  it("inserts an event under the application's tenant with the canonical registration_open status", async () => {
    const app = baseApplication({ event_routing: "college" })
    const result = await createEventForApplication(app, "FMAS Course")
    expect("eventId" in result).toBe(true)

    const events = mockClient.current!._tables.get("events")!
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      tenant: "college",
      status: "registration_open",
      registration_open: true,
      created_by: EVENT_CREATED_BY_USER_ID,
    })
  })

  it("routes an amasi-tenant type (e.g. nextgen) correctly", async () => {
    const app = baseApplication({ application_type_id: "nextgen", event_routing: "amasi" })
    const result = await createEventForApplication(app, "NextGen")
    expect("eventId" in result).toBe(true)
    expect(mockClient.current!._tables.get("events")![0]).toMatchObject({ tenant: "amasi" })
  })

  it("creates no event when routing is 'none', including for blood_donation", async () => {
    const app = baseApplication({ application_type_id: "blood_donation", event_routing: "none" })
    const result = await createEventForApplication(app, "Blood Donation Drive")
    expect("error" in result).toBe(true)
    expect(mockClient.current!._tables.get("events")!).toHaveLength(0)
  })

  it("falls back to preferred_date_1 when finalized_date is null (the SPARC-workshop fix)", async () => {
    const app = baseApplication({ finalized_date: null, preferred_date_1: "2026-09-27" })
    await createEventForApplication(app, "Workshop")
    expect(mockClient.current!._tables.get("events")![0]).toMatchObject({
      start_date: "2026-09-27",
      end_date: "2026-09-27",
    })
  })
})

describe("getDefaultEventRouting", () => {
  beforeEach(() => {
    mockClient.current = createMockSupabase({ academic_event_types: [] })
  })

  it("reads default_event_routing from academic_event_types when the row exists", async () => {
    mockClient.current!._setTable("academic_event_types", [{ id: "fmas", default_event_routing: "college" }])
    expect(await getDefaultEventRouting("fmas")).toBe("college")
  })

  it("falls back to the static map for blood_donation when the type row is missing", async () => {
    expect(await getDefaultEventRouting("blood_donation" as ApplicationTypeId)).toBe("none")
  })

  it("falls back to the static map for amasicon (none, post-decision)", async () => {
    expect(await getDefaultEventRouting("amasicon" as ApplicationTypeId)).toBe("none")
  })
})

describe("isEventRoutingLocked", () => {
  it("is false when there's no linked event", async () => {
    const client = createMockSupabase({})
    expect(await isEventRoutingLocked(client as never, null)).toBe(false)
  })

  it("is false when the event has no registrations or sold tickets", async () => {
    const client = createMockSupabase({
      registrations: [],
      ticket_types: [{ event_id: "evt-1", quantity_sold: 0 }],
    })
    expect(await isEventRoutingLocked(client as never, "evt-1")).toBe(false)
  })

  it("is true once a registration exists", async () => {
    const client = createMockSupabase({
      registrations: [{ id: "reg-1", event_id: "evt-1" }],
      ticket_types: [],
    })
    expect(await isEventRoutingLocked(client as never, "evt-1")).toBe(true)
  })

  it("is true once a ticket type has sold units, even with zero registrations", async () => {
    const client = createMockSupabase({
      registrations: [],
      ticket_types: [{ event_id: "evt-1", quantity_sold: 3 }],
    })
    expect(await isEventRoutingLocked(client as never, "evt-1")).toBe(true)
  })
})

describe("syncEventRegistration", () => {
  it("nudges a draft event to registration_open when opening", async () => {
    const client = createMockSupabase({ events: [{ id: "evt-1", status: "draft", registration_open: false }] })
    const ok = await syncEventRegistration(client as never, "evt-1", true)
    expect(ok).toBe(true)
    expect(client._tables.get("events")![0]).toMatchObject({ status: "registration_open", registration_open: true })
  })

  it("never moves status backward when closing registration", async () => {
    const client = createMockSupabase({ events: [{ id: "evt-1", status: "active", registration_open: true }] })
    await syncEventRegistration(client as never, "evt-1", false)
    expect(client._tables.get("events")![0]).toMatchObject({ status: "active", registration_open: false })
  })

  it("leaves a non-draft status untouched when opening (already further along)", async () => {
    const client = createMockSupabase({ events: [{ id: "evt-1", status: "active", registration_open: false }] })
    await syncEventRegistration(client as never, "evt-1", true)
    expect(client._tables.get("events")![0]).toMatchObject({ status: "active", registration_open: true })
  })
})
