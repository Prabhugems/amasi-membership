import { describe, it, expect } from "vitest"
import { EVENT_TYPE_CONFIG, getEventTypeConfig } from "@/lib/mou/event-type-config"
import { RURAL_PROGRAM_CLAUSES, WORKSHOP_CLAUSES } from "@/lib/mou/mou-pdf"
import { SMALL_STATE_CHAPTER_STATES } from "@/lib/mou/small-state-chapters"

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

describe("rural_program and workshop MouEventTypeConfig", () => {
  it("both carry mouClauses matching the exported PDF clause arrays exactly", () => {
    const rural = EVENT_TYPE_CONFIG.rural_program
    const workshop = EVENT_TYPE_CONFIG.workshop
    expect(rural.mouClauses).toEqual(RURAL_PROGRAM_CLAUSES)
    expect(workshop.mouClauses).toEqual(WORKSHOP_CLAUSES)
  })

  it("both have exactly 14 agreements, each with a non-empty clauseRef and text", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const config = EVENT_TYPE_CONFIG[id]
      expect(config.agreements).toHaveLength(14)
      for (const a of config.agreements) {
        expect(a.clauseRef.length).toBeGreaterThan(0)
        expect(a.text.length).toBeGreaterThan(0)
      }
    }
  })

  it("both require venue and a 45-day lead time", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const config = EVENT_TYPE_CONFIG[id]
      expect(config.requiresVenue).toBe(true)
      expect(config.minLeadDays).toBe(45)
    }
  })

  it("both use 'Organizing Secretary name' as the organizer-name label", () => {
    expect(EVENT_TYPE_CONFIG.rural_program.organizerNameLabel).toBe("Organizing Secretary name")
    expect(EVENT_TYPE_CONFIG.workshop.organizerNameLabel).toBe("Organizing Secretary name")
  })

  it("rural_program's venue_setting field blocks Urban with the clause-4 message", () => {
    const venueField = EVENT_TYPE_CONFIG.rural_program.typeSpecificFields.find(
      (f): f is Extract<typeof f, { kind: "radio" }> => f.kind === "radio" && f.key === "venue_setting"
    )
    expect(venueField).toBeDefined()
    expect(venueField?.blockValue?.value).toBe("Urban")
    expect(venueField?.blockValue?.message).toContain("Clause 4")
  })

  it("only workshop has smallStateException, using SMALL_STATE_CHAPTER_STATES", () => {
    expect(EVENT_TYPE_CONFIG.rural_program.smallStateException).toBeUndefined()
    expect(EVENT_TYPE_CONFIG.workshop.smallStateException?.states).toBe(SMALL_STATE_CHAPTER_STATES)
  })

  it("only workshop has an eventSubtypeWarning", () => {
    expect(EVENT_TYPE_CONFIG.rural_program.eventSubtypeWarning).toBeUndefined()
    expect(EVENT_TYPE_CONFIG.workshop.eventSubtypeWarning).toBeTruthy()
  })

  it("faculty-rows field defs are capped 1-20 and shared between both types (same object reference or deep-equal shape)", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const facultyField = EVENT_TYPE_CONFIG[id].typeSpecificFields.find((f) => f.kind === "faculty-rows")
      expect(facultyField).toMatchObject({ kind: "faculty-rows", minRows: 1, maxRows: 20 })
    }
  })

  it("association-rows field defs are capped at 10 for both types", () => {
    for (const id of ["rural_program", "workshop"] as const) {
      const assocField = EVENT_TYPE_CONFIG[id].typeSpecificFields.find((f) => f.kind === "association-rows")
      expect(assocField).toMatchObject({ kind: "association-rows", maxRows: 10 })
    }
  })

  it("the other 7 event types have no typeSpecificFields/mouClauses/agreements (unchanged shape)", () => {
    const untouchedIds = ["fmas", "mmas", "dmas", "slcp", "nextgen", "meet_the_master", "zonal_event"] as const
    for (const id of untouchedIds) {
      const config = EVENT_TYPE_CONFIG[id]
      expect(config.typeSpecificFields).toBeUndefined()
      expect(config.mouClauses).toBeUndefined()
      expect(config.agreements).toBeUndefined()
    }
  })
})
