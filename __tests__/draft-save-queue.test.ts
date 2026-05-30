/**
 * DraftSaveQueue regression tests.
 *
 * Closes AMASI-MEMBERSHIP-D (44 users impacted, regressed, last seen on the
 * 92dbd2e release). The pre-queue saveDraftToServer call sites at
 * apply/page.tsx:946 (since removed), :1136, :1174 each fired their own
 * fetch in parallel during the typical 3-doc OCR burst on the upload step,
 * saturating the server-side optimistic lock on draft_applications.updated_at.
 *
 * These tests assert the queue's two invariants:
 *
 *   1. At most one executor call is in flight at any time, regardless of how
 *      many enqueue() bursts arrive. This is the property that prevents the
 *      lock-saturation storm.
 *
 *   2. Burst enqueues coalesce into a single follow-up call whose step is
 *      Math.max(...) and whose extraData is the shallow-merge of all batched
 *      calls. All burst callers resolve with the same single result, matching
 *      the pre-queue fire-and-forget semantics.
 *
 * Do not relax either property without re-reading
 * src/lib/draft-save-queue.ts header and the apply/page.tsx call sites that
 * now route through enqueueDraftSave.
 */
import { describe, expect, it } from "vitest"
import { DraftSaveQueue, type DraftSaveJob, type DraftSaveResult } from "@/lib/draft-save-queue"

// A controllable executor: each call returns a promise whose resolver is
// exposed via the returned `resolve` array, indexed by call number.
// Mirrors the way the real saveDraftToServer is slow under bad network.
function makeControllableExecutor() {
  const calls: DraftSaveJob[] = []
  const resolvers: Array<(r: DraftSaveResult) => void> = []
  let concurrent = 0
  let maxConcurrent = 0
  const executor = (job: DraftSaveJob): Promise<DraftSaveResult> => {
    calls.push(job)
    concurrent++
    if (concurrent > maxConcurrent) maxConcurrent = concurrent
    return new Promise<DraftSaveResult>((resolve) => {
      resolvers.push((r) => {
        concurrent--
        resolve(r)
      })
    })
  }
  return {
    executor,
    calls,
    resolvers,
    getMaxConcurrent: () => maxConcurrent,
  }
}

describe("DraftSaveQueue", () => {
  it("runs a single enqueue immediately and resolves the caller's promise", async () => {
    const { executor, calls, resolvers } = makeControllableExecutor()
    const queue = new DraftSaveQueue(executor)

    const p = queue.enqueue(3, { foo: "bar" })

    // Give the microtask queue a chance to start the executor.
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({ step: 3, extraData: { foo: "bar" } })
    expect(queue.hasInFlight).toBe(true)

    resolvers[0]({ ok: true, error: null })
    await expect(p).resolves.toEqual({ ok: true, error: null })
    expect(queue.hasInFlight).toBe(false)
    expect(queue.hasPending).toBe(false)
  })

  it("serialises a 3-doc upload burst — only one in-flight at any moment", async () => {
    const { executor, calls, resolvers, getMaxConcurrent } = makeControllableExecutor()
    const queue = new DraftSaveQueue(executor)

    // The exact pattern AMASI-MEMBERSHIP-D fired on: 3 OCR completions land
    // within the same millisecond, each previously firing its own fetch.
    const p1 = queue.enqueue(3, { uploads: { mci_certificate: {} } })
    const p2 = queue.enqueue(3, { uploads: { pg_degree_certificate: {} } })
    const p3 = queue.enqueue(3, { uploads: { profile: {} } })

    await Promise.resolve()

    // The first call is in flight; the next two are coalesced into pending.
    expect(calls).toHaveLength(1)
    expect(queue.hasInFlight).toBe(true)
    expect(queue.hasPending).toBe(true)

    // Resolve the first batch — pending drains into the second executor call.
    resolvers[0]({ ok: true, error: null })
    await expect(p1).resolves.toEqual({ ok: true, error: null })
    await Promise.resolve() // let drain() schedule the next executor call
    expect(calls).toHaveLength(2)

    // Second call carries the coalesced extraData from #2 and #3.
    expect(calls[1].step).toBe(3)
    expect(calls[1].extraData).toEqual({
      uploads: { profile: {} }, // shallow-merged, last write wins on key collisions
    })

    resolvers[1]({ ok: true, error: null })
    const [r2, r3] = await Promise.all([p2, p3])
    expect(r2).toEqual({ ok: true, error: null })
    expect(r3).toEqual({ ok: true, error: null })

    // Invariant: at no point did two executors run in parallel. This is the
    // single property that closes the 409 storm.
    expect(getMaxConcurrent()).toBe(1)
    expect(calls).toHaveLength(2)
  })

  it("takes Math.max(step) across a coalesced batch", async () => {
    const { executor, calls, resolvers } = makeControllableExecutor()
    const queue = new DraftSaveQueue(executor)

    const p1 = queue.enqueue(3, { a: 1 })
    const p2 = queue.enqueue(4, { b: 2 })          // advances step
    const p3 = queue.enqueue(2, { c: 3 })          // lower step, must NOT regress

    await Promise.resolve()
    expect(calls[0]).toEqual({ step: 3, extraData: { a: 1 } })

    resolvers[0]({ ok: true, error: null })
    await Promise.all([p1])
    await Promise.resolve()

    // Coalesced second batch: step 4 wins, extraData merged with last write.
    expect(calls).toHaveLength(2)
    expect(calls[1].step).toBe(4)
    expect(calls[1].extraData).toEqual({ b: 2, c: 3 })

    resolvers[1]({ ok: true, error: null })
    await Promise.all([p2, p3])
  })

  it("propagates failure from a single executor call to all coalesced waiters", async () => {
    const { executor, resolvers } = makeControllableExecutor()
    const queue = new DraftSaveQueue(executor)

    const p1 = queue.enqueue(3)
    await Promise.resolve()
    const p2 = queue.enqueue(3, { uploads: { profile: {} } })
    const p3 = queue.enqueue(3, { uploads: { mci_certificate: {} } })

    // First batch fails.
    resolvers[0]({ ok: false, error: "conflict" })
    await expect(p1).resolves.toEqual({ ok: false, error: "conflict" })

    // Second batch (coalesced p2+p3) runs after; let it fail too.
    await Promise.resolve()
    resolvers[1]({ ok: false, error: "timeout" })
    const [r2, r3] = await Promise.all([p2, p3])
    expect(r2).toEqual({ ok: false, error: "timeout" })
    expect(r3).toEqual({ ok: false, error: "timeout" })
  })

  it("surfaces executor throws as ok:false without crashing the queue", async () => {
    const queue = new DraftSaveQueue(async () => { throw new Error("network down") })

    const p1 = queue.enqueue(3)
    const p2 = queue.enqueue(3, { uploads: { profile: {} } })

    const r1 = await p1
    expect(r1.ok).toBe(false)
    expect(r1.error).toMatch(/network down/i)

    // Queue must remain usable for the next batch.
    const r2 = await p2
    expect(r2.ok).toBe(false)
    expect(r2.error).toMatch(/network down/i)
  })

  it("handles enqueues that arrive while drain is in progress", async () => {
    // Simulates the case where a save() finishes and a brand-new caller
    // (not a coalesce) enqueues during the microtask gap before the queue
    // settles. The queue must process the new caller as a fresh batch.
    const { executor, calls, resolvers, getMaxConcurrent } = makeControllableExecutor()
    const queue = new DraftSaveQueue(executor)

    const p1 = queue.enqueue(3)
    await Promise.resolve()
    expect(calls).toHaveLength(1)
    resolvers[0]({ ok: true, error: null })
    await p1

    const p2 = queue.enqueue(4)
    await Promise.resolve()
    expect(calls).toHaveLength(2)
    expect(calls[1].step).toBe(4)
    resolvers[1]({ ok: true, error: null })
    await p2

    expect(getMaxConcurrent()).toBe(1)
  })
})
