import { describe, it, expect, vi } from "vitest"

const capture = vi.fn()
vi.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => capture(...a) }))

import { reportEmailResult } from "@/lib/assert-email-sent"

describe("reportEmailResult", () => {
  it("returns true and stays quiet on success", () => {
    expect(reportEmailResult({ error: null }, "x")).toBe(true)
    expect(capture).not.toHaveBeenCalled()
  })
  it("reports a Resend error that did not throw", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(reportEmailResult({ error: { message: "domain not verified" } }, "ticket-x")).toBe(false)
    expect(capture).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it("tolerates an undefined result", () => {
    expect(reportEmailResult(undefined, "x")).toBe(true)
  })
})
