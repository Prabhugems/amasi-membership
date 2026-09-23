import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"

const { mockClient, sendReminderMock, sendEscalationMock } = vi.hoisted(() => ({
  mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null },
  sendReminderMock: vi.fn(),
  sendEscalationMock: vi.fn(),
}))
vi.mock("@/lib/supabase", () => ({ createAdminClient: () => mockClient.current }))
vi.mock("@/lib/mou/notify", () => ({
  sendReportReminderEmail: sendReminderMock,
  sendReportEscalationEmail: sendEscalationMock,
}))
vi.mock("@/lib/mou/supabase-helpers", () => ({
  getRoleAssignment: vi.fn().mockResolvedValue({ name: "Hon. Secretary", email: "sec@example.com", phone: null }),
}))
vi.mock("@/lib/mou/approval-token", () => ({ createApprovalToken: vi.fn().mockResolvedValue("raw-token") }))

import { runMouReportReminders } from "@/lib/mou-report-reminders"

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "app-1",
    application_type_id: "fmas",
    status: "approved",
    organizer_name: "Dr. Test",
    email: "organizer@example.com",
    finalized_date: null,
    preferred_date_1: daysAgo(0),
    report_submitted_at: null,
    report_reminder_7_sent_at: null,
    report_reminder_15_sent_at: null,
    report_escalation_sent_at: null,
    ...overrides,
  }
}

describe("runMouReportReminders — timing off the event date", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("sends the day-7 reminder once the event is 7+ days past, not before", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        baseRow({ id: "not-due", preferred_date_1: daysAgo(6) }),
        baseRow({ id: "due", preferred_date_1: daysAgo(7) }),
      ],
    })
    const result = await runMouReportReminders()
    expect(result.reminder7Sent).toBe(1)
    expect(sendReminderMock).toHaveBeenCalledTimes(1)
    expect(sendReminderMock.mock.calls[0][0]).toMatchObject({ id: "due" })
    expect(sendReminderMock.mock.calls[0][2]).toBe("day7")
  })

  it("counts from finalized_date, not preferred_date_1, when finalized_date is set", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        // preferred_date_1 alone would be within the 7-day window, but
        // finalized_date (the actual event date) is 7 days out — must count
        // from finalized_date per the doc's explicit ask.
        baseRow({ id: "due", preferred_date_1: daysAgo(1), finalized_date: daysAgo(7) }),
      ],
    })
    const result = await runMouReportReminders()
    expect(result.reminder7Sent).toBe(1)
  })

  it("sends day-15 and escalates (Secretary + director, since fmas has one) once past day 15", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseRow({ preferred_date_1: daysAgo(15) })],
    })
    const result = await runMouReportReminders()
    expect(result.reminder15Sent).toBe(1)
    expect(result.escalationsSent).toBe(1)
    // Secretary always, plus director_fmas for an fmas application.
    expect(sendEscalationMock).toHaveBeenCalledTimes(2)
  })

  it("does not double-send — a reminder already stamped is skipped even if still in the window", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        baseRow({ preferred_date_1: daysAgo(10), report_reminder_7_sent_at: new Date().toISOString() }),
      ],
    })
    const result = await runMouReportReminders()
    expect(result.reminder7Sent).toBe(0)
    expect(sendReminderMock).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "day7")
  })

  it("stops once report_submitted_at is set, even past day 15", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        baseRow({ preferred_date_1: daysAgo(20), report_submitted_at: new Date().toISOString() }),
      ],
    })
    const result = await runMouReportReminders()
    expect(result.reminder7Sent).toBe(0)
    expect(result.reminder15Sent).toBe(0)
    expect(result.escalationsSent).toBe(0)
  })

  it("skips applications not yet approved (submitted/rejected) regardless of date", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        baseRow({ id: "rejected", status: "rejected", preferred_date_1: daysAgo(20) }),
        baseRow({ id: "submitted", status: "submitted", preferred_date_1: daysAgo(20) }),
      ],
    })
    const result = await runMouReportReminders()
    expect(result.reminder7Sent + result.reminder15Sent + result.escalationsSent).toBe(0)
  })

  it("a 'none'-routed (MOU-only) application still gets reminded on its event date", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [
        baseRow({ application_type_id: "rural_program", event_routing: "none", preferred_date_1: daysAgo(7) }),
      ],
    })
    const result = await runMouReportReminders()
    expect(result.reminder7Sent).toBe(1)
  })

  it("dry run reports candidates without sending or claiming", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseRow({ preferred_date_1: daysAgo(7) })],
    })
    const result = await runMouReportReminders({ dryRun: true })
    expect(result.reminder7Sent).toBe(0)
    expect(sendReminderMock).not.toHaveBeenCalled()
    expect(result.skippedDetails.some((s) => s.stage === "day7" && s.reason === "dry run")).toBe(true)
  })
})
