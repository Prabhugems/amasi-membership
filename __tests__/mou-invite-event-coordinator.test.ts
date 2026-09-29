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

const sendCoordinatorInviteEmail = vi.fn()
vi.mock("@/lib/mou/notify", () => ({ sendCoordinatorInviteEmail }))

import { inviteEventCoordinator } from "@/lib/mou/event-routing"

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
