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

    const tick = async () => {
      try {
        const res = await fetch(`/api/${table}/count`, { cache: "no-store" })
        if (cancelled || !res.ok) return
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

    const intervalId = setInterval(tick, pollMs)
    return () => {
      cancelled = true
      clearInterval(intervalId)
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [table, flashMs, pollMs])

  return { count, flashing }
}
