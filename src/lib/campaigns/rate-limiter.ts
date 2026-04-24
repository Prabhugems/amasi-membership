export interface Pacer {
  wait: () => Promise<void>
}

export function createPacer(minGapMs: number): Pacer {
  let nextAllowed = 0
  return {
    async wait() {
      const now = Date.now()
      const delay = Math.max(0, nextAllowed - now)
      nextAllowed = Math.max(now, nextAllowed) + minGapMs
      if (delay > 0) {
        await new Promise((r) => setTimeout(r, delay))
      }
    },
  }
}
