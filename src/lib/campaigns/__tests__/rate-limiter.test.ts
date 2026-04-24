import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createPacer } from "../rate-limiter"

describe("createPacer", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("first wait() resolves immediately", async () => {
    const pacer = createPacer(500)
    const p = pacer.wait()
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()
  })

  it("second wait() waits minGapMs from the first", async () => {
    const pacer = createPacer(500)
    await pacer.wait()
    let resolved = false
    pacer.wait().then(() => { resolved = true })
    await vi.advanceTimersByTimeAsync(499)
    expect(resolved).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(resolved).toBe(true)
  })

  it("pace advances on every call, regardless of caller outcome", async () => {
    const pacer = createPacer(100)
    await pacer.wait()   // t=0
    await vi.advanceTimersByTimeAsync(100)
    await pacer.wait()   // t=100
    await vi.advanceTimersByTimeAsync(100)
    await pacer.wait()   // t=200 — three calls in 200ms is correct for 100ms gap
  })
})
