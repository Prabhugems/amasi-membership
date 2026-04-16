"use client"

import { useEffect, useState, useCallback } from "react"
import { usePathname } from "next/navigation"

const STORAGE_KEY = "amasi-recent-routes"
const MAX = 5

export interface RecentRoute {
  href: string
  label: string
  visitedAt: number
}

// Map a pathname to a friendly label. Add more as routes grow.
function labelFor(pathname: string): string | null {
  if (pathname === "/") return null // don't track dashboard itself
  if (pathname.startsWith("/pending/")) {
    const id = pathname.split("/")[2]
    return `Application ${id?.slice(0, 8)}`
  }
  if (pathname === "/pending") return "Pending Applications"
  if (pathname === "/members") return "All Members"
  if (pathname.startsWith("/members/")) return "Member Detail"
  if (pathname === "/admin") return "Admin Users"
  if (pathname === "/audit") return "Activity Log"
  if (pathname === "/reports") return "Reports"
  if (pathname === "/tickets") return "Support Tickets"
  if (pathname.startsWith("/tickets/")) return "Ticket Detail"
  if (pathname === "/upgrades") return "Upgrades"
  if (pathname === "/notifications") return "Notifications"
  if (pathname === "/search") return "Search"
  return null
}

function readStorage(): RecentRoute[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.slice(0, MAX)
  } catch {
    return []
  }
}

function writeStorage(items: RecentRoute[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX)))
  } catch {}
}

/** Track current route + read history */
export function useRecentRoutes() {
  const pathname = usePathname()
  const [routes, setRoutes] = useState<RecentRoute[]>([])

  // Initial load
  useEffect(() => {
    setRoutes(readStorage())
  }, [])

  // Push current pathname when it changes
  useEffect(() => {
    if (typeof window === "undefined") return
    const label = labelFor(pathname)
    if (!label) return
    setRoutes((prev) => {
      const filtered = prev.filter((r) => r.href !== pathname)
      const next = [{ href: pathname, label, visitedAt: Date.now() }, ...filtered].slice(0, MAX)
      writeStorage(next)
      return next
    })
  }, [pathname])

  const clear = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY)
    setRoutes([])
  }, [])

  return { routes, clear }
}
