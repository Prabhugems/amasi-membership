"use client"

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

interface DashboardData {
  pendingApplicationsCount?: number
}

type DashboardQuery = { status: boolean; data: DashboardData } | undefined

// Passive observer of the dashboard cache — subscribes to cache events without
// owning or fetching the query. The main dashboard page is the authoritative fetcher.
export function DynamicTitle(): null {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<number>(0)

  useEffect(() => {
    const key = ["dashboard", "30d"]
    const readPending = () => {
      const data = queryClient.getQueryData<DashboardQuery>(key)
      setPending(data?.data?.pendingApplicationsCount ?? 0)
    }
    readPending()
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const qKey = event.query.queryKey
      if (Array.isArray(qKey) && qKey[0] === "dashboard" && qKey[1] === "30d") {
        readPending()
      }
    })
    return () => unsubscribe()
  }, [queryClient])

  useEffect(() => {
    if (typeof document === "undefined") return
    // Always strip existing prefix before writing, so repeat renders don't stack.
    const stripRegex = /^\(\d+\)\s*/
    const current = document.title
    const base = current.replace(stripRegex, "")
    const next = pending > 0 ? `(${pending}) ${base}` : base
    if (current !== next) {
      document.title = next
    }
    return () => {
      if (typeof document === "undefined") return
      document.title = document.title.replace(stripRegex, "")
    }
  }, [pending])

  return null
}
