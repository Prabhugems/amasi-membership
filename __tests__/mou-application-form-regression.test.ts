import { describe, it, expect } from "vitest"
import { EVENT_TYPE_CONFIG, isMouEventTypeConfig } from "@/lib/mou/event-type-config"

describe("application-form.tsx branch condition (regression guard)", () => {
  it("the 7 non-framework types are NOT MouEventTypeConfig — they take the original render path", () => {
    const untouchedIds = ["fmas", "mmas", "dmas", "slcp", "nextgen", "meet_the_master", "zonal_event"] as const
    for (const id of untouchedIds) {
      expect(isMouEventTypeConfig(EVENT_TYPE_CONFIG[id])).toBe(false)
    }
  })

  it("rural_program and workshop ARE MouEventTypeConfig — they take the new render path", () => {
    expect(isMouEventTypeConfig(EVENT_TYPE_CONFIG.rural_program)).toBe(true)
    expect(isMouEventTypeConfig(EVENT_TYPE_CONFIG.workshop)).toBe(true)
  })
})
