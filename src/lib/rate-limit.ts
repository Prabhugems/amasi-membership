import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
}

let redis: Redis | null = null
function getRedis(): Redis | null {
  if (redis) return redis
  const url = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL)?.trim()
  const token = (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN)?.trim()
  if (!url || !token) return null
  redis = new Redis({ url, token })
  return redis
}

const limiters = new Map<string, Ratelimit>()

function getLimiter(prefix: string, limit: number, windowSec: number): Ratelimit | null {
  const r = getRedis()
  if (!r) return null
  const key = `${prefix}:${limit}:${windowSec}`
  let limiter = limiters.get(key)
  if (!limiter) {
    limiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(limit, `${windowSec} s`),
      prefix: `rl:${prefix}`,
    })
    limiters.set(key, limiter)
  }
  return limiter
}

// In-memory fallback for local dev without Upstash
interface WindowEntry { count: number; resetAt: number }
const windows = new Map<string, WindowEntry>()

function inMemoryCheck(key: string, limit: number, windowMs: number): RateLimitResult {
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

export async function checkRateLimit(
  key: string,
  limit = 5,
  windowMs = 15 * 60 * 1000
): Promise<RateLimitResult> {
  const windowSec = Math.ceil(windowMs / 1000)
  const prefix = key.split(":")[0] || "default"
  const limiter = getLimiter(prefix, limit, windowSec)

  if (!limiter) {
    return inMemoryCheck(key, limit, windowMs)
  }

  try {
    const result = await limiter.limit(key)
    return {
      allowed: result.success,
      remaining: result.remaining,
      resetAt: result.reset,
    }
  } catch {
    // Redis unreachable — fall back to in-memory
    return inMemoryCheck(key, limit, windowMs)
  }
}
