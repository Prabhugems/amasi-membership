"use client"

import { useEffect } from "react"

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return
    if (!("serviceWorker" in navigator)) return
    if (process.env.NODE_ENV !== "production") return

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
      // Per project rule: surface impossible/unexpected states loudly.
      console.error("[pwa] service worker registration failed", err)
    })
  }, [])

  return null
}
