// Sentry's beforeSend / beforeSendTransaction hook must never throw.
// It used to JSON.stringify the whole event; server events and
// transactions can hold circular references, so it threw "Converting
// circular structure to JSON" on ordinary requests (Razorpay webhook,
// crons, settings) -- about one error per request, which used up the whole
// Sentry org's error quota from 8 Nov 2026 and hid every other app's errors.
import { describe, it, expect } from "vitest"
import { scrubSurveyTokenFromEvent } from "@/lib/scrub-survey-token"

const TOKEN = "IVJd_21YOMRAxirxDrrFtxFL0oE7mzbDS-hQDfGQlvo"

describe("scrubSurveyTokenFromEvent on awkward events", () => {
  it("does not throw on a circular event, and still scrubs the token", () => {
    const event: Record<string, unknown> = { request: { url: `https://m.test/survey/${TOKEN}` } }
    event.self = event
    ;(event.request as Record<string, unknown>).parent = event
    let out: unknown
    expect(() => (out = scrubSurveyTokenFromEvent(event))).not.toThrow()
    // The loops are cut in the copy, so the whole copy serialises and holds no token.
    expect(JSON.stringify(out)).not.toContain(TOKEN)
    expect((out as { self: unknown }).self).toBe("[Circular]")
    expect((out as { request: { url: string } }).request.url).toBe("https://m.test/survey/[token]")
  })

  it("does not throw on a circular event with no token, and returns it untouched", () => {
    const event: Record<string, unknown> = { transaction: "POST /api/webhooks/razorpay", contexts: {} }
    ;(event.contexts as Record<string, unknown>).back = event
    const out = scrubSurveyTokenFromEvent(event)
    expect(out).toBe(event)
    expect((event.contexts as Record<string, unknown>).back).toBe(event)
  })

  it("keeps a value that appears twice (not a loop)", () => {
    const shared = { url: `/survey/${TOKEN}` }
    const out = scrubSurveyTokenFromEvent({ a: shared, b: shared }) as { a: { url: string }; b: { url: string } }
    expect(out.a.url).toBe("/survey/[token]")
    expect(out.b.url).toBe("/survey/[token]")
  })

  it("scrubs tokens inside arrays (breadcrumbs, spans)", () => {
    const out = scrubSurveyTokenFromEvent({
      breadcrumbs: [{ data: { url: `/api/survey/${TOKEN}` } }],
      spans: [{ description: `GET /survey/${TOKEN}` }],
    })
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })

  it("scrubs tokens inside read-only values too", () => {
    const frozen = Object.freeze({ url: `/survey/${TOKEN}` })
    const getterOnly = Object.defineProperty({}, "url", { get: () => `/survey/${TOKEN}`, enumerable: true })
    const out = scrubSurveyTokenFromEvent({ a: frozen, b: getterOnly })
    expect(JSON.stringify(out)).not.toContain(TOKEN)
  })

  it("falls back to scrubbing in place when the event can't be serialised at all", () => {
    const event = { big: BigInt(1), request: { url: `/survey/${TOKEN}` } }
    let out: unknown
    expect(() => (out = scrubSurveyTokenFromEvent(event))).not.toThrow()
    expect(out).toBe(event)
    expect(event.request.url).toBe("/survey/[token]")
  })

  it("never throws, whatever it is given", () => {
    for (const v of [null, undefined, 0, "", "x", [], new Date(), new Map()]) {
      expect(() => scrubSurveyTokenFromEvent(v)).not.toThrow()
    }
  })
})
