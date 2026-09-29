// Regression test for the bug found + fixed 2026-09-29: every MOU-approval
// code path (decide/route.ts, retry-event/route.ts, routing/route.ts) used
// to insert a team_invitations row directly and stop there — the applicant
// was told "check your inbox for that invite" (sendOutcomeEmail's copy) but
// no email was ever actually sent. inviteEventCoordinator (src/lib/mou/
// event-routing.ts) is the single place all three now go through instead;
// this test is the one place that actually asserts the email gets sent,
// not just that the DB row exists.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"
import type { AcademicEventApplication } from "@/lib/mou/types"

const { sendCoordinatorInviteEmail, sendDirectorEventCreatedNotice, getRoleAssignment } = vi.hoisted(() => ({
  sendCoordinatorInviteEmail: vi.fn(),
  sendDirectorEventCreatedNotice: vi.fn(),
  getRoleAssignment: vi.fn(),
}))
vi.mock("@/lib/mou/notify", () => ({ sendCoordinatorInviteEmail, sendDirectorEventCreatedNotice }))
vi.mock("@/lib/mou/supabase-helpers", () => ({ getRoleAssignment }))

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))

import { inviteEventCoordinator, notifyEventDirector } from "@/lib/mou/event-routing"

function app(overrides: Partial<AcademicEventApplication> = {}): AcademicEventApplication {
  return {
    id: "app-1",
    application_type_id: "fmas",
    organizer_name: "Dr. Organiser",
    ...overrides,
  } as unknown as AcademicEventApplication
}

describe("inviteEventCoordinator", () => {
  beforeEach(() => {
    sendCoordinatorInviteEmail.mockClear()
  })

  it("inserts a coordinator team_invitations row AND sends the invite email", async () => {
    const client = createMockSupabase({ team_invitations: [] })
    await inviteEventCoordinator(client as never, {
      email: "organiser@example.com",
      name: "Dr. Organiser",
      eventId: "evt-1",
      eventName: "128 FMAS Course — Mumbai, Maharashtra",
      tenant: "college",
    })

    const invitations = client._tables.get("team_invitations")!
    expect(invitations).toHaveLength(1)
    expect(invitations[0]).toMatchObject({
      email: "organiser@example.com",
      name: "Dr. Organiser",
      role: "coordinator",
      event_ids: ["evt-1"],
    })

    expect(sendCoordinatorInviteEmail).toHaveBeenCalledTimes(1)
    const [email, name, eventName, inviteLink] = sendCoordinatorInviteEmail.mock.calls[0]
    expect(email).toBe("organiser@example.com")
    expect(name).toBe("Dr. Organiser")
    expect(eventName).toBe("128 FMAS Course — Mumbai, Maharashtra")
    expect(inviteLink).toMatch(/^https:\/\/collegeofmas\.org\.in\/team\/accept-invite\?token=/)
  })

  it("points the invite link at events.amasi.org for an amasi-tenant event", async () => {
    const client = createMockSupabase({ team_invitations: [] })
    await inviteEventCoordinator(client as never, {
      email: "director@example.com",
      name: "National Director",
      eventId: "evt-2",
      eventName: "31 AMASI NextGen",
      tenant: "amasi",
    })

    const inviteLink = sendCoordinatorInviteEmail.mock.calls[0][3]
    expect(inviteLink).toMatch(/^https:\/\/events\.amasi\.org\/team\/accept-invite\?token=/)
  })

  it("throws (rather than swallowing) when the insert fails, so callers' existing Sentry capture still fires", async () => {
    // No forced-error path in the shared mock (see its own header comment:
    // "extend only the methods a new test genuinely needs") — simulate a
    // DB failure the simplest way available: a client whose insert()
    // rejects the chain with an error, matching the {data, error} shape
    // every real caller already checks for.
    const failingClient = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: "insert failed" } }),
          }),
        }),
      }),
    }
    await expect(
      inviteEventCoordinator(failingClient as never, {
        email: "organiser@example.com",
        name: "Dr. Organiser",
        eventId: "evt-1",
        eventName: "Some Event",
        tenant: "college",
      })
    ).rejects.toThrow("insert failed")
    expect(sendCoordinatorInviteEmail).not.toHaveBeenCalled()
  })
})

// Regression test for the 2026-09-29 policy change: the National Director
// no longer becomes a team member/coordinator (that was itself a same-day
// revert of the fix above) — they get an FYI-only email instead, with no
// team_invitations row and no access.
describe("notifyEventDirector", () => {
  beforeEach(() => {
    sendDirectorEventCreatedNotice.mockClear()
    getRoleAssignment.mockReset()
  })

  it("sends an FYI notice to the assigned director, with no DB write", async () => {
    getRoleAssignment.mockResolvedValue({ name: "Dr. Director", email: "director@example.com", phone: null })
    await notifyEventDirector(app({ application_type_id: "fmas" }), "FMAS Course", "128 FMAS Course")

    expect(getRoleAssignment).toHaveBeenCalledWith("director_fmas")
    expect(sendDirectorEventCreatedNotice).toHaveBeenCalledWith(
      "director@example.com",
      "Dr. Director",
      "128 FMAS Course",
      "FMAS Course",
      "Dr. Organiser"
    )
  })

  it("is a no-op for an application type with no director seat (e.g. mmas)", async () => {
    await notifyEventDirector(app({ application_type_id: "mmas" }), "MMAS Course", "Some MMAS Event")
    expect(getRoleAssignment).not.toHaveBeenCalled()
    expect(sendDirectorEventCreatedNotice).not.toHaveBeenCalled()
  })

  it("is a no-op when the director role has nobody currently assigned", async () => {
    getRoleAssignment.mockResolvedValue(null)
    await notifyEventDirector(app({ application_type_id: "nextgen" }), "NextGen", "31 AMASI NextGen")
    expect(sendDirectorEventCreatedNotice).not.toHaveBeenCalled()
  })

  it("swallows a notify failure internally rather than throwing (FYI is lower-stakes than the coordinator invite)", async () => {
    getRoleAssignment.mockResolvedValue({ name: "Dr. Director", email: "director@example.com", phone: null })
    sendDirectorEventCreatedNotice.mockRejectedValueOnce(new Error("resend down"))
    await expect(notifyEventDirector(app(), "FMAS Course", "128 FMAS Course")).resolves.toBeUndefined()
  })
})
