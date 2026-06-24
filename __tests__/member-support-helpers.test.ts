import { describe, it, expect } from "vitest"
import {
  TICKET_CATEGORIES, PRIORITIES, statusMeta, extractAttachment, isImageUrl,
} from "@/components/member-support/support-constants"

describe("member-support helpers", () => {
  it("exposes the canonical categories", () => {
    expect(TICKET_CATEGORIES).toEqual([
      "Application Issue", "Profile Update", "Payment Issue",
      "Certificate/Card", "Technical Issue", "Other",
    ])
  })

  it("offers member-selectable priorities defaulting list with normal", () => {
    expect(PRIORITIES.map(p => p.value)).toEqual(["low", "normal", "high"])
  })

  it("returns lowercase labels and a dot class for each status", () => {
    expect(statusMeta("open").label).toBe("open")
    expect(statusMeta("in_progress").label).toBe("in progress")
    expect(statusMeta("resolved").label).toBe("resolved")
    expect(statusMeta("closed").label).toBe("closed")
    expect(statusMeta("open").dotClass).toMatch(/bg-/)
  })

  it("splits an attachment marker out of a reply message", () => {
    const r = extractAttachment("Here you go 📎 Attachment: https://x.test/a.png")
    expect(r.text).toBe("Here you go")
    expect(r.url).toBe("https://x.test/a.png")
  })

  it("returns the message unchanged when there is no marker", () => {
    expect(extractAttachment("just text")).toEqual({ text: "just text", url: null })
    expect(extractAttachment(undefined)).toEqual({ text: "", url: null })
  })

  it("detects image urls", () => {
    expect(isImageUrl("https://x.test/p.JPG")).toBe(true)
    expect(isImageUrl("https://x.test/doc.pdf")).toBe(false)
  })
})
