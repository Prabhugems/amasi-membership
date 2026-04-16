"use client"

import { useCallback, type MouseEvent } from "react"

/**
 * Returns an onClick handler that creates a ripple effect from click position.
 * The element must be `position: relative; overflow: hidden`.
 */
export function useRipple<T extends HTMLElement>() {
  return useCallback((e: MouseEvent<T>) => {
    const target = e.currentTarget
    const rect = target.getBoundingClientRect()
    const size = Math.max(rect.width, rect.height)
    const x = e.clientX - rect.left - size / 2
    const y = e.clientY - rect.top - size / 2

    const ripple = document.createElement("span")
    ripple.className = "ripple-effect"
    ripple.style.width = ripple.style.height = `${size}px`
    ripple.style.left = `${x}px`
    ripple.style.top = `${y}px`

    target.appendChild(ripple)
    setTimeout(() => ripple.remove(), 650)
  }, [])
}
