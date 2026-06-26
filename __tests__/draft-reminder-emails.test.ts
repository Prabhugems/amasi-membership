import { describe, it, expect } from "vitest"
import {
  INCOMPLETE_REMINDER_SUBJECT,
  PAID_PENDING_REMINDER_SUBJECT,
  buildIncompleteReminderBody,
  buildPaidPendingReminderBody,
} from "@/lib/draft-reminder-emails"

describe("buildIncompleteReminderBody", () => {
  it("renders the step label and resume URL", () => {
    const html = buildIncompleteReminderBody({
      stepLabel: "Document Upload",
      resumeUrl: "https://membership.amasi.org/apply",
    })
    expect(html).toContain("Document Upload")
    expect(html).toContain("https://membership.amasi.org/apply")
    expect(html).toContain("Resume Application")
  })

  it("omits the removal hint when not provided", () => {
    const html = buildIncompleteReminderBody({
      stepLabel: "Payment",
      resumeUrl: "https://x/apply",
    })
    expect(html).not.toContain("removed")
  })

  it("includes the removal hint when provided", () => {
    const html = buildIncompleteReminderBody({
      stepLabel: "Payment",
      resumeUrl: "https://x/apply",
      removalHint: "Will be removed after further inactivity.",
    })
    expect(html).toContain("Will be removed after further inactivity.")
  })

  it("escapes step label content", () => {
    const html = buildIncompleteReminderBody({
      stepLabel: "<script>x</script>",
      resumeUrl: "https://x/apply",
    })
    expect(html).not.toContain("<script>x</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})

describe("buildPaidPendingReminderBody", () => {
  it("explicitly reassures the user they will not be charged again", () => {
    const html = buildPaidPendingReminderBody({
      resumeUrl: "https://membership.amasi.org/apply?resume=tok",
    })
    expect(html).toContain("not be charged again")
  })

  it("never references the step label or the removal hint", () => {
    const html = buildPaidPendingReminderBody({
      resumeUrl: "https://x",
    })
    expect(html).not.toMatch(/paused at/i)
    expect(html).not.toMatch(/removed/i)
  })

  it("renders a 'Complete Submission' CTA pointing at the resume URL", () => {
    const html = buildPaidPendingReminderBody({
      resumeUrl: "https://x/apply?resume=tok123",
    })
    expect(html).toContain("Complete Submission")
    expect(html).toContain("https://x/apply?resume=tok123")
  })

  it("escapes the resume URL", () => {
    const html = buildPaidPendingReminderBody({
      resumeUrl: "https://x/apply?resume=<evil>",
    })
    expect(html).not.toContain("?resume=<evil>")
    expect(html).toContain("&lt;evil&gt;")
  })
})

describe("subject constants", () => {
  it("uses distinct subjects so inbox grouping separates the two cohorts", () => {
    expect(PAID_PENDING_REMINDER_SUBJECT).not.toBe(INCOMPLETE_REMINDER_SUBJECT)
    expect(PAID_PENDING_REMINDER_SUBJECT.toLowerCase()).toContain("payment")
  })
})
