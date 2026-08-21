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

function jsonResponse(body: unknown) {
  return { json: async () => body }
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
})
