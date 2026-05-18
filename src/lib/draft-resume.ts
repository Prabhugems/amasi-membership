import { randomUUID } from "node:crypto"
import { signToken } from "@/lib/auth"

/**
 * Sign a resume-link token for a given draft. Emitted into reminder emails
 * as the `?resume=<token>` query param on /apply. The handler at
 * /api/applications/draft/resume-from-token verifies it, claims its jti
 * atomically (single-use), issues a member cookie, and returns the draft
 * so the applicant lands back on the right step with form pre-populated —
 * no OTP re-entry.
 *
 * TTL default 14d: long enough to survive a weekend of inbox neglect, short
 * enough that a leaked link eventually dies. Email possession is the auth
 * factor; don't stretch this past a few weeks.
 *
 * jti: random UUID so resume-from-token can claim it once via Redis and
 * reject replays. Without this, anyone reading the inbox could re-use the
 * link until TTL expiry.
 */
export async function signResumeToken(draftId: string, email: string, ttl: string = "14d"): Promise<string> {
  return signToken(
    {
      role: "member",
      email: email.toLowerCase().trim(),
      draftId,
      source: "resume_link",
      jti: randomUUID(),
    },
    ttl,
  )
}
