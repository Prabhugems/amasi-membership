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

  it("only zonal_event requires the zone field", () => {
    for (const [id, config] of Object.entries(EVENT_TYPE_CONFIG)) {
      const hasZone = config.fields.includes("zone")
      expect(hasZone).toBe(id === "zonal_event")
    }
  })

  it("getEventTypeConfig returns null for an unknown type", () => {
    expect(getEventTypeConfig("not_a_real_type")).toBeNull()
  })

  it("getEventTypeConfig returns the config for a known type", () => {
    expect(getEventTypeConfig("fmas")?.label).toBe("FMAS Course")
  })
})
