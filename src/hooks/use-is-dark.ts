"use client"

import { useEffect, useState } from "react"

/**
 * Tracks whether the root <html> element has the `dark` class applied.
 * Initializes synchronously if possible to avoid a light-to-dark flicker.
 */
export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof document === "undefined") return false
    return document.documentElement.classList.contains("dark")
  })
  useEffect(() => {
    const el = document.documentElement
    const check = () => setIsDark(el.classList.contains("dark"))
    check()
    const obs = new MutationObserver(check)
    obs.observe(el, { attributes: true, attributeFilter: ["class"] })
    return () => obs.disconnect()
  }, [])
  return isDark
}
