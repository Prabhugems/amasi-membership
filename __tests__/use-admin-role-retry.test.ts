/**
 * Regression test for src/hooks/use-admin-role.ts's fetchWithRetry().
 *
 * Bug (2026-08-21): a single transient failure of GET /api/auth/me (dropped
 * request, network blip while other page resources were still loading) used
 * to permanently cache "not an admin" for the rest of that page session —
 * the sidebar's `adminRole === null` gate then stayed hidden until the user
 * noticed and did a full manual reload. Fix: retry a few times with a short
 * backoff before finalizing to null. This file tests fetchWithRetry()
 * directly (exported for this purpose) rather than rendering the hook —
 * no React Testing Library in this project's test setup, and the retry
 * logic is plain async code with no React state involved.
 *
 * 2026-08-21 follow-up (audit finding): the first version of this fix only
 * retried network-level failures. But api/auth/me/route.ts's own catch
 * block used to return a clean 401 {authenticated:false} on ITS internal
 * errors too — indistinguishable from a genuine "not logged in" response,
 * so that failure mode was never retried at all. The route now returns 500
 * on its own errors specifically so this can tell the two apart; the tests
 * below pin that distinction (retry on 5xx, not on 401).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { fetchWithRetry } from "@/hooks/use-admin-role"

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock)
  fetchMock.mockReset()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return { status, json: async () => body }
}

describe("fetchWithRetry", () => {
  it("resolves immediately on a successful authenticated response — no retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: true, user: { adminRole: "super_admin" } }))

    const result = await fetchWithRetry()

    expect(result).toEqual({ resolved: true, adminRole: "super_admin" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("resolves immediately with adminRole: null on a successful unauthenticated response — no retry", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: false }))

    const result = await fetchWithRetry()

    expect(result).toEqual({ resolved: true, adminRole: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("retries after a network failure and succeeds on the second attempt", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, user: { adminRole: "admin" } }))

    const promise = fetchWithRetry()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ resolved: true, adminRole: "admin" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("retries after an unparseable response (r.json() throws) and succeeds", async () => {
    fetchMock
      .mockResolvedValueOnce({ json: async () => { throw new Error("invalid json") } })
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, user: { adminRole: "super_admin" } }))

    const promise = fetchWithRetry()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ resolved: true, adminRole: "super_admin" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("gives up after exhausting retries and finalizes to adminRole: null", async () => {
    fetchMock.mockRejectedValue(new Error("persistent network failure"))

    const promise = fetchWithRetry()
    await vi.runAllTimersAsync()
    const result = await promise

    // 1 initial attempt + 3 retries = 4 total calls, matching MAX_RETRIES = 3.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result).toEqual({ resolved: true, adminRole: null })
  })

  it("retries a 500 (the route's own internal error) and succeeds on the next attempt", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Session check failed" }, 500))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, user: { adminRole: "super_admin" } }, 200))

    const promise = fetchWithRetry()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toEqual({ resolved: true, adminRole: "super_admin" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does NOT retry a 401 — a real 'not authenticated' answer resolves immediately, even though it's an error status", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ authenticated: false }, 401))

    const result = await fetchWithRetry()

    expect(result).toEqual({ resolved: true, adminRole: null })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
