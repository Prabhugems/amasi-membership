interface WindowEntry {
  count: number
  resetAt: number
}

const windows = new Map<string, WindowEntry>()

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

/**
 * Sliding window rate limiter (in-memory, per-process).
 * NOT suitable for multi-instance serverless — use Redis/Vercel KV in production.
 *
 * @param key — unique identifier (IP, email, combination)
 * @param limit — max requests per window
 * @param windowMs — window duration in ms
 */
export function checkRateLimit(key: string, limit = 5, windowMs = 15 * 60 * 1000): RateLimitResult {
  const now = Date.now()
  const entry = windows.get(key)

  if (!entry || entry.resetAt < now) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs }
  }

  if (entry.count >= limit) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt }
  }

  entry.count++
  return { allowed: true, remaining: limit - entry.count, resetAt: entry.resetAt }
}

// Periodic cleanup (runs when imported)
if (typeof globalThis !== "undefined") {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of windows.entries()) {
      if (entry.resetAt < now) windows.delete(key)
    }
  }, 60 * 1000).unref?.()
}
