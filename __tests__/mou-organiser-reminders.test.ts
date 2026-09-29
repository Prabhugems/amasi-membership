import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"

const { mockClient, sendSetupStatusMock, sendEventReminderMock } = vi.hoisted(() => ({
  mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null },
  sendSetupStatusMock: vi.fn(),
  sendEventReminderMock: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => mockClient.current }))
vi.mock("@/lib/mou/notify", () => ({
  sendOrganiserSetupStatusEmail: sendSetupStatusMock,
  sendOrganiserEventReminderEmail: sendEventReminderMock,
}))

import { runWeeklySetupStatusEmails, run3DayEventReminders, EVENT_REMINDER_DAYS_AHEAD } from "@/lib/mou-organiser-reminders"

function daysFromNow(n: number): string {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function baseApp(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    application_type_id: "fmas",
    organizer_name: "Dr. Test",
    email: "organizer@example.com",
    created_event_id: "evt-1",
    setup_status_last_sent_at: null,
    event_reminder_3day_sent_at: null,
    ...overrides,
  }
}

function baseEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    name: "128 FMAS Course",
    start_date: daysFromNow(10),
    status: "registration_open",
    ...overrides,
  }
}

describe("runWeeklySetupStatusEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sends for an fmas event never sent before, with a done:false ticket-types item when there are none", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp()],
      events: [baseEvent()],
      ticket_types: [],
    })
    const result = await runWeeklySetupStatusEmails()
    expect(result.sent).toBe(1)
    expect(sendSetupStatusMock).toHaveBeenCalledTimes(1)
    const [app, , eventName, checklist] = sendSetupStatusMock.mock.calls[0]
    expect(app).toMatchObject({ id: "app-1" })
    expect(eventName).toBe("128 FMAS Course")
    expect(checklist).toEqual([{ label: "Ticket types configured", done: false }])
  })

  it("reports done:true when the event already has ticket types", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp()],
      events: [baseEvent()],
      ticket_types: [{ id: "tt-1", event_id: "evt-1" }],
    })
    await runWeeklySetupStatusEmails()
    const checklist = sendSetupStatusMock.mock.calls[0][3]
    expect(checklist).toEqual([{ label: "Ticket types configured", done: true }])
  })

  it("skips a non-fmas/mmas application type (e.g. nextgen)", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp({ application_type_id: "nextgen" })],
      events: [baseEvent()],
      ticket_types: [],
    })
    const result = await runWeeklySetupStatusEmails()
    expect(result.sent).toBe(0)
    expect(sendSetupStatusMock).not.toHaveBeenCalled()
  })

  it("skips once the event has already happened", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp()],
      events: [baseEvent({ start_date: daysAgo(1) })],
      ticket_types: [],
    })
    const result = await runWeeklySetupStatusEmails()
    expect(result.sent).toBe(0)
    expect(sendSetupStatusMock).not.toHaveBeenCalled()
  })

  it("does not resend within 7 days of the last send", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp({ setup_status_last_sent_at: daysAgo(3) })],
      events: [baseEvent()],
      ticket_types: [],
    })
    const result = await runWeeklySetupStatusEmails()
    expect(result.sent).toBe(0)
    expect(sendSetupStatusMock).not.toHaveBeenCalled()
  })

  it("resends once 7+ days have passed since the last send", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp({ setup_status_last_sent_at: daysAgo(8) })],
      events: [baseEvent()],
      ticket_types: [],
    })
    const result = await runWeeklySetupStatusEmails()
    expect(result.sent).toBe(1)
  })
})

describe("run3DayEventReminders", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it(`sends when the event is exactly ${EVENT_REMINDER_DAYS_AHEAD} days away, with the confirmed registration count`, async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp()],
      events: [baseEvent({ start_date: daysFromNow(EVENT_REMINDER_DAYS_AHEAD) })],
      registrations: [
        { id: "r1", event_id: "evt-1", status: "confirmed" },
        { id: "r2", event_id: "evt-1", status: "confirmed" },
        { id: "r3", event_id: "evt-1", status: "pending" },
      ],
    })
    const result = await run3DayEventReminders()
    expect(result.sent).toBe(1)
    expect(sendEventReminderMock).toHaveBeenCalledTimes(1)
    const [app, , , , registeredCount] = sendEventReminderMock.mock.calls[0]
    expect(app).toMatchObject({ id: "app-1" })
    expect(registeredCount).toBe(2)
  })

  it("does not send when the event is more than 3 days away", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp()],
      events: [baseEvent({ start_date: daysFromNow(10) })],
      registrations: [],
    })
    const result = await run3DayEventReminders()
    expect(result.sent).toBe(0)
    expect(sendEventReminderMock).not.toHaveBeenCalled()
  })

  it("does not resend once already sent", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApp({ event_reminder_3day_sent_at: daysAgo(1) })],
      events: [baseEvent({ start_date: daysFromNow(2) })],
      registrations: [],
    })
    const result = await run3DayEventReminders()
    expect(result.sent).toBe(0)
    expect(sendEventReminderMock).not.toHaveBeenCalled()
  })
})
