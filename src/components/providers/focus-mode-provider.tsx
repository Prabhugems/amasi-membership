"use client"

import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode } from "react"
import { useSidebar } from "@/components/providers/sidebar-provider"

interface FocusModeContextValue {
  isFocusMode: boolean
  enter: () => void
  exit: () => void
  toggle: () => void
}

const FocusModeContext = createContext<FocusModeContextValue | null>(null)

export function useFocusMode(): FocusModeContextValue {
  const ctx = useContext(FocusModeContext)
  if (!ctx) throw new Error("useFocusMode must be used inside FocusModeProvider")
  return ctx
}

const STORAGE_KEY = "amasi-focus-mode"

export function FocusModeProvider({ children }: { children: ReactNode }) {
  const [isFocusMode, setFocusMode] = useState(false)
  const sidebar = useSidebar()
  const previousCollapsedRef = useRef<boolean | null>(null)

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem(STORAGE_KEY)
      if (stored === "1") {
        setFocusMode(true)
        document.body.classList.add("focus-mode")
        previousCollapsedRef.current = sidebar.collapsed
        sidebar.setCollapsed(true)
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const apply = useCallback((on: boolean) => {
    setFocusMode(on)
    try { sessionStorage.setItem(STORAGE_KEY, on ? "1" : "0") } catch {}
    if (on) {
      document.body.classList.add("focus-mode")
      previousCollapsedRef.current = sidebar.collapsed
      sidebar.setCollapsed(true)
    } else {
      document.body.classList.remove("focus-mode")
      if (previousCollapsedRef.current !== null) {
        sidebar.setCollapsed(previousCollapsedRef.current)
        previousCollapsedRef.current = null
      }
    }
  }, [sidebar])

  const enter = useCallback(() => apply(true), [apply])
  const exit = useCallback(() => apply(false), [apply])
  const toggle = useCallback(() => apply(!isFocusMode), [apply, isFocusMode])

  // Keyboard: Shift+F to toggle, Escape to exit (when in focus mode)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const isInteractive =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "BUTTON" ||
        tag === "A" ||
        tag === "SELECT" ||
        (target?.isContentEditable ?? false) ||
        target?.getAttribute("role") === "button" ||
        target?.closest("[role='dialog']") !== null  // also skip when modal is open
      if (isInteractive) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      if (e.shiftKey && e.key === "F") {
        e.preventDefault()
        apply(!isFocusMode)
      } else if (e.key === "Escape" && isFocusMode) {
        apply(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [isFocusMode, apply])

  return (
    <FocusModeContext.Provider value={{ isFocusMode, enter, exit, toggle }}>
      {children}
    </FocusModeContext.Provider>
  )
}
