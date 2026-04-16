"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

const CHORDS: Record<string, string> = {
  d: "/",
  m: "/members",
  p: "/pending",
  r: "/reports",
  t: "/tickets",
  a: "/audit",
  s: "/search",
  u: "/upgrades",
  n: "/notifications",
}

export function NavChord(): null {
  const router = useRouter()

  useEffect(() => {
    let chord: "g" | null = null
    let chordTimer: ReturnType<typeof setTimeout> | null = null

    function clearChord() {
      chord = null
      if (chordTimer) {
        clearTimeout(chordTimer)
        chordTimer = null
      }
    }

    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        (target?.isContentEditable ?? false)
      if (isEditable) return

      // Don't hijack if any modifier is held (⌘K etc is handled elsewhere)
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const key = e.key.toLowerCase()

      if (chord === "g") {
        if (CHORDS[key]) {
          e.preventDefault()
          router.push(CHORDS[key])
        }
        clearChord()
        return
      }

      if (key === "g") {
        chord = "g"
        if (chordTimer) clearTimeout(chordTimer)
        chordTimer = setTimeout(clearChord, 800)
      }
    }

    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      if (chordTimer) clearTimeout(chordTimer)
    }
  }, [router])

  return null
}
