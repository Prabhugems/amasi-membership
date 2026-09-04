import { describe, it, expect } from "vitest"
import { EVENT_TYPE_CONFIG, getEventTypeConfig } from "@/lib/mou/event-type-config"

describe("EVENT_TYPE_CONFIG", () => {
  it("has exactly the 9 in-scope event types", () => {
    const ids = Object.keys(EVENT_TYPE_CONFIG).sort()
    expect(ids).toEqual([
      "dmas", "fmas", "meet_the_master", "mmas", "nextgen",
      "rural_program", "slcp", "workshop", "zonal_event",
    ].sort())
  })

  it("every event type requires the zone field", () => {
    for (const config of Object.values(EVENT_TYPE_CONFIG)) {
      expect(config.fields).toContain("zone")
    }
  })

  it("getEventTypeConfig returns null for an unknown type", () => {
    expect(getEventTypeConfig("not_a_real_type")).toBeNull()
  })

  it("getEventTypeConfig returns the config for a known type", () => {
    expect(getEventTypeConfig("fmas")?.label).toBe("FMAS Course")
  })
})
