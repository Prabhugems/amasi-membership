"use client"

import { useEffect, useState } from "react"

type AdminRoleState = {
  resolved: boolean
  adminRole: string | null
}

let cached: AdminRoleState | null = null
let inflight: Promise<AdminRoleState> | null = null
const subscribers = new Set<(s: AdminRoleState) => void>()

// A transient failure (dropped request, network blip while other page
// resources are still loading) used to permanently cache "not an admin" —
// the sidebar's `adminRole === null` gate then stayed hidden for the rest
// of that page session, only fixable by a full manual reload. Retry a few
// times with a short backoff before genuinely giving up, so a one-off
// hiccup self-heals instead of requiring the user to notice and refresh.
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 500

function publish(next: AdminRoleState) {
  cached = next
  subscribers.forEach((cb) => cb(next))
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

// Only network-level failures or an unparseable response are retried — a
// successful response (even an "authenticated: false" one) is a real,
// final answer and resolves immediately.
// Exported only for direct testing (__tests__/use-admin-role-retry.test.ts)
// — not part of the hook's public API, which stays useAdminRole/
// useAdminRoleState.
export async function fetchWithRetry(attempt = 0): Promise<AdminRoleState> {
  try {
    const r = await fetch("/api/auth/me")
    const data = await r.json()
    const role =
      data?.authenticated && data?.user?.adminRole ? data.user.adminRole : null
    return { resolved: true, adminRole: role }
  } catch {
    if (attempt < MAX_RETRIES) {
      await sleep(RETRY_DELAY_MS * (attempt + 1))
      return fetchWithRetry(attempt + 1)
    }
    return { resolved: true, adminRole: null }
  }
}

function fetchOnce(): Promise<AdminRoleState> {
  if (cached) return Promise.resolve(cached)
  if (inflight) return inflight
  inflight = fetchWithRetry()
    .then((next) => {
      publish(next)
      return next
    })
    .finally(() => {
      inflight = null
    })
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
