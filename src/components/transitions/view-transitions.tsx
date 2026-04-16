"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export function ViewTransitions(): null {
  const router = useRouter()

  useEffect(() => {
    if (typeof document === "undefined") return
    if (typeof document.startViewTransition !== "function") return

    function onClick(e: MouseEvent) {
      const target = (e.target as HTMLElement | null)?.closest?.("a")
      if (!(target instanceof HTMLAnchorElement)) return
      if (target.target && target.target !== "_self") return
      if (e.defaultPrevented) return
      if (e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return

      const url = new URL(target.href, location.origin)
      if (url.origin !== location.origin) return
      if (url.pathname === location.pathname) return

      e.preventDefault()
      document.startViewTransition(() => {
        router.push(url.pathname + url.search + url.hash)
      })
    }

    document.addEventListener("click", onClick, { capture: true })
    return () => document.removeEventListener("click", onClick, { capture: true })
  }, [router])

  return null
}
