"use client"

import { useEffect, useState } from "react"

type AdminRoleState = {
  resolved: boolean
  adminRole: string | null
}

let cached: AdminRoleState | null = null
let inflight: Promise<AdminRoleState> | null = null
const subscribers = new Set<(s: AdminRoleState) => void>()

function publish(next: AdminRoleState) {
  cached = next
  subscribers.forEach((cb) => cb(next))
}

function fetchOnce(): Promise<AdminRoleState> {
  if (cached) return Promise.resolve(cached)
  if (inflight) return inflight
  inflight = fetch("/api/auth/me")
    .then((r) => r.json())
    .then((data): AdminRoleState => {
      const role =
        data?.authenticated && data?.user?.adminRole ? data.user.adminRole : null
      const next: AdminRoleState = { resolved: true, adminRole: role }
      publish(next)
      return next
    })
    .catch((): AdminRoleState => {
      const next: AdminRoleState = { resolved: true, adminRole: null }
      publish(next)
      return next
    })
    .finally(() => {
      inflight = null
    }) as Promise<AdminRoleState>
  return inflight
}

export function useAdminRoleState(): AdminRoleState {
  const [state, setState] = useState<AdminRoleState>(
    () => cached ?? { resolved: false, adminRole: null }
  )

  useEffect(() => {
    subscribers.add(setState)
    // If another subscriber resolved between this component's render and
    // effect mount, sync to the latest cached value. Without this, this
    // subscriber would stay on the stale initial snapshot until the next
    // /api/auth/me call (which won't happen because the cache is populated).
    if (cached && cached !== state) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(cached)
    } else if (!cached) {
      void fetchOnce()
    }
    return () => {
      subscribers.delete(setState)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}

export function useAdminRole(): string | null {
  return useAdminRoleState().adminRole
}
