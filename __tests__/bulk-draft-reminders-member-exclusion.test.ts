/**
 * Regression test: bulk-draft-reminders must not email applicants who
 * already have an approved `members` row, even when they have no matching
 * `membership_applications` row under the same email (e.g. they revisit
 * /apply post-approval and a stray draft is created — see
 * src/app/api/otp/send/route.ts — then goes idle).
 *
 * Root cause: the exclusion set only anti-joined against
 * `membership_applications`, never `members`. The sibling job
 * `cleanup-drafts/route.ts` already anti-joins against both tables; this
 * fix ports that pattern to bulk-draft-reminders.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest"

const draftCandidates = [
  {
    id: "draft-already-member",
    email: "already-member@example.com",
    current_step: 3,
    updated_at: "2020-01-01T00:00:00.000Z",
    reminder_sent_at: null,
    reminder_count: 0,
    status: "in_progress",
  },
  {
    id: "draft-fresh-applicant",
    email: "fresh-applicant@example.com",
    current_step: 2,
    updated_at: "2020-01-01T00:00:00.000Z",
    reminder_sent_at: null,
    reminder_count: 0,
    status: "in_progress",
  },
]

const existingApps: { email: string }[] = []
const existingMembers = [{ email: "already-member@example.com" }]

// ── Resend mock — no real network calls ───────────────────────────────────
const sendMock = vi.fn(async (args: { to: string; [key: string]: unknown }) => ({ data: { id: "email_test_id", to: args.to }, error: null }))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: sendMock }
  },
}))

vi.mock("@/lib/draft-resume", () => ({
  signResumeToken: vi.fn(async () => "fake-resume-token"),
}))

vi.mock("@/lib/audit-log", () => ({
  logMembershipAuditEvent: vi.fn(async () => undefined),
}))

// ── Supabase mock ──────────────────────────────────────────────────────────
//
// Chain shapes exercised by runBulkDraftReminders:
//   1. from("draft_applications").select().in().lte().lt().or()          → candidates
//   2. from("membership_applications").select().in()                    → existingApps
//   3. from("members").select().in()                                    → existingMembers
//   4. from("draft_applications").update().eq().eq().lt().or().select().maybeSingle() → atomic claim
vi.mock("@/lib/supabase", () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "draft_applications") {
        return {
          select: () => ({
            in: () => ({
              lte: () => ({
                lt: () => ({
                  or: async () => ({ data: draftCandidates, error: null }),
                }),
              }),
            }),
          }),
          update: () => ({
            eq: (_col: string, id: string) => ({
              eq: () => ({
                lt: () => ({
                  or: () => ({
                    select: () => ({
                      maybeSingle: async () => ({ data: { id } }),
                    }),
                  }),
                }),
              }),
            }),
          }),
        }
      }
      if (table === "membership_applications") {
        return { select: () => ({ in: async () => ({ data: existingApps, error: null }) }) }
      }
      if (table === "members") {
        return { select: () => ({ in: async () => ({ data: existingMembers, error: null }) }) }
      }
      throw new Error(`Unmocked Supabase table: ${table}`)
    },
  })),
}))

process.env.RESEND_API_KEY = "test_resend_key_not_real"

// Import AFTER mocks are wired
import { runBulkDraftReminders } from "@/lib/bulk-draft-reminders"

beforeEach(() => {
  sendMock.mockClear()
})

describe("bulk draft reminders — members-table exclusion", () => {
  it("skips a draft whose email already has an approved members row", async () => {
    const result = await runBulkDraftReminders("system:test")

    expect(result.sent).toBe(1)
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: "fresh-applicant@example.com" })

    const skippedEmails = result.skippedDetails.map((s) => s.email)
    expect(skippedEmails).toContain("already-member@example.com")
    const skippedReason = result.skippedDetails.find((s) => s.email === "already-member@example.com")?.reason
    expect(skippedReason).toBe("already has submitted application")
  })
})
