/**
 * Single-in-flight save queue for the /apply draft auto-save path.
 *
 * Closes AMASI-MEMBERSHIP-D — the "first attempt times out, retry hits 409"
 * race that fires every time multiple OCR completions try to update
 * draft_applications.step_data in parallel:
 *
 *   1. Doc A completes OCR → save-draft #1 starts.
 *   2. Doc B completes OCR ~200 ms later → save-draft #2 starts.
 *   3. #1's response is slow on a mobile network → client's 12 s
 *      AbortSignal.timeout fires → client treats as failure.
 *   4. #1 retries with a stale lastUpdatedAt → server's optimistic lock
 *      (on updated_at) returns 409.
 *   5. By the time #1's retry sees the fresh serverUpdatedAt, #2 has
 *      already advanced updated_at again → 409 forever → AMASI-MEMBERSHIP-D.
 *
 * The queue collapses the burst into one in-flight save plus one coalescing
 * "pending" slot:
 *
 *   - While a save is in flight, new enqueue() calls merge into the pending
 *     slot (shallow-merge extraData, take Math.max(step)).
 *   - When the in-flight save resolves, pending is drained as the next save.
 *   - All callers waiting on a coalesced batch resolve with the batch's
 *     single result — same ok/error semantics they had pre-queue.
 *
 * The queue does NOT understand the wire protocol. The executor passed to
 * the constructor handles the fetch, the optimistic-lock thread-through, and
 * any 409 retry. The server-side lastUpdatedAt re-lock at
 * /api/applications/save-draft is preserved unchanged — the queue just stops
 * the burst from racing the lock in the first place.
 */

export interface DraftSaveJob {
  step: number
  extraData?: Record<string, unknown>
}

export interface DraftSaveResult {
  ok: boolean
  error: string | null
}

export type DraftSaveExecutor = (job: DraftSaveJob) => Promise<DraftSaveResult>

export class DraftSaveQueue {
  private readonly executor: DraftSaveExecutor
  private inFlight: Promise<DraftSaveResult> | null = null
  private pending: DraftSaveJob | null = null
  private pendingResolvers: Array<(result: DraftSaveResult) => void> = []

  constructor(executor: DraftSaveExecutor) {
    this.executor = executor
  }

  enqueue(step: number, extraData?: Record<string, unknown>): Promise<DraftSaveResult> {
    return new Promise<DraftSaveResult>((resolve) => {
      this.pendingResolvers.push(resolve)
      this.pending = coalesce(this.pending, { step, extraData })
      this.drain()
    })
  }

  // Test hooks. Not part of the runtime contract.
  get hasInFlight(): boolean { return this.inFlight !== null }
  get hasPending(): boolean { return this.pending !== null }
  get pendingJob(): DraftSaveJob | null { return this.pending }

  private drain(): void {
    if (this.inFlight !== null) return
    if (this.pending === null) return
    const job = this.pending
    const resolvers = this.pendingResolvers
    this.pending = null
    this.pendingResolvers = []
    this.inFlight = this.execute(job, resolvers)
  }

  private async execute(
    job: DraftSaveJob,
    resolvers: Array<(result: DraftSaveResult) => void>,
  ): Promise<DraftSaveResult> {
    let result: DraftSaveResult
    try {
      result = await this.executor(job)
    } catch (err) {
      result = {
        ok: false,
        error: err instanceof Error ? err.message : "draft-save-queue: executor threw",
      }
    }
    for (const r of resolvers) r(result)
    this.inFlight = null
    // A caller may have enqueued during execute(); drain that batch now.
    this.drain()
    return result
  }
}

function coalesce(prev: DraftSaveJob | null, next: DraftSaveJob): DraftSaveJob {
  if (prev === null) {
    return {
      step: next.step,
      extraData: next.extraData ? { ...next.extraData } : undefined,
    }
  }
  return {
    step: Math.max(prev.step, next.step),
    extraData: mergeExtraData(prev.extraData, next.extraData),
  }
}

function mergeExtraData(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!a && !b) return undefined
  if (!a) return { ...b }
  if (!b) return { ...a }
  return { ...a, ...b }
}
