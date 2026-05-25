"use client"

import { useEffect, useRef, useState } from "react"

export interface UseRealtimeCountOptions {
  table: string
  initialCount: number
  /** ms to keep the "flash" state on after a count increase */
  flashMs?: number
  /** polling interval in ms; default 5000 */
  pollMs?: number
}

// Polls GET /api/${table}/count for { count: number }. Replaces a prior
// Supabase realtime subscription that exposed full row payloads to the
// browser via anon key. Hook contract { count, flashing } unchanged.
export function useRealtimeCount({
  table,
  initialCount,
  flashMs = 1000,
  pollMs = 5000,
}: UseRealtimeCountOptions) {
  const [count, setCount] = useState(initialCount)
  const [flashing, setFlashing] = useState(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevCountRef = useRef(initialCount)

  // Re-baseline whenever the parent feeds a fresh initialCount (react-query refetch).
  useEffect(() => {
    setCount(initialCount)
    prevCountRef.current = initialCount
  }, [initialCount])

  useEffect(() => {
    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const tick = async () => {
      try {
        const res = await fetch(`/api/${table}/count`, { cache: "no-store" })
        if (cancelled) return
        if (res.status === 401) {
          // Halt the poll once the admin cookie is gone. Otherwise this
          // 5s loop fires `Middleware rejected /api/*` warnings
          // (AMASI-MEMBERSHIP-7) up to ~6 times before the 30s dashboard
          // query notices the same 401 and redirects via the useEffect in
          // src/app/page.tsx. Mirrors the `retry: false on 401` pattern on
          // the heatmap query (page.tsx:239) — halt locally, let the
          // dashboard query own the redirect to /login.
          if (intervalId !== null) {
            clearInterval(intervalId)
            intervalId = null
          }
          return
        }
        if (!res.ok) return
        const data = await res.json().catch(() => null)
        if (cancelled || typeof data?.count !== "number") return

        const next = data.count
        const prev = prevCountRef.current
        if (next === prev) return

        setCount(next)
        prevCountRef.current = next

        if (next > prev) {
          setFlashing(true)
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
          flashTimerRef.current = setTimeout(() => setFlashing(false), flashMs)
        }
      } catch {
        // best-effort polling — swallow network blips
      }
    }

    intervalId = setInterval(tick, pollMs)
    return () => {
      cancelled = true
      if (intervalId !== null) clearInterval(intervalId)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [table, flashMs, pollMs])

  return { count, flashing }
}
