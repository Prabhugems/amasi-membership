"use client"

import { useEffect, useState, useRef } from "react"
import { createBrowserClient } from "@/lib/supabase"

export interface UseRealtimeCountOptions {
  table: string
  initialCount: number
  /** ms to keep the "flash" state on after an insert */
  flashMs?: number
}

export function useRealtimeCount({ table, initialCount, flashMs = 1000 }: UseRealtimeCountOptions) {
  const [count, setCount] = useState(initialCount)
  const [flashing, setFlashing] = useState(false)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync to incoming initialCount changes (e.g., when react-query refetches)
  useEffect(() => { setCount(initialCount) }, [initialCount])

  useEffect(() => {
    const supabase = createBrowserClient()
    const channel = supabase
      .channel(`rt:${table}`)
      .on(
        "postgres_changes" as any,
        { event: "INSERT", schema: "public", table },
        () => {
          setCount((prev) => prev + 1)
          setFlashing(true)
          if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
          flashTimerRef.current = setTimeout(() => setFlashing(false), flashMs)
        }
      )
      .subscribe()

    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      supabase.removeChannel(channel)
    }
  }, [table, flashMs])

  return { count, flashing }
}
