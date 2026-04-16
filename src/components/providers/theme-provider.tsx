"use client"

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"

export type Theme = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider")
  return ctx
}

const STORAGE_KEY = "amasi-theme"

function getSystemPreference(): "light" | "dark" {
  if (typeof window === "undefined") return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function isNightTime(): boolean {
  const hour = new Date().getHours()
  return hour >= 19 || hour < 7
}

function resolve(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    if (isNightTime()) return "dark"
    return getSystemPreference()
  }
  return theme
}

function applyTheme(resolved: "light" | "dark") {
  if (typeof document === "undefined") return
  const root = document.documentElement
  if (resolved === "dark") root.classList.add("dark")
  else root.classList.remove("dark")
  root.style.colorScheme = resolved
}

export function ThemeProvider({
  children,
  defaultTheme = "system",
}: {
  children: ReactNode
  defaultTheme?: Theme
}) {
  const [theme, setThemeState] = useState<Theme>(defaultTheme)
  const [resolvedTheme, setResolvedTheme] = useState<"light" | "dark">("light")

  useEffect(() => {
    try {
      const stored = (localStorage.getItem(STORAGE_KEY) as Theme | null) || defaultTheme
      setThemeState(stored)
      const r = resolve(stored)
      setResolvedTheme(r)
      applyTheme(r)
    } catch {
      const r = resolve(defaultTheme)
      setResolvedTheme(r)
      applyTheme(r)
    }
  }, [defaultTheme])

  useEffect(() => {
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    function handler(e: MediaQueryListEvent) {
      // When OS preference changes, re-resolve through the auto logic
      // (time-of-day may still force dark even if OS says light).
      const r = isNightTime() ? "dark" : e.matches ? "dark" : "light"
      setResolvedTheme(r)
      applyTheme(r)
    }
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [theme])

  useEffect(() => {
    if (theme !== "system") return
    const id = setInterval(() => {
      const r = resolve("system")
      setResolvedTheme(prev => {
        if (prev !== r) {
          applyTheme(r)
          return r
        }
        return prev
      })
    }, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [theme])

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
    const r = resolve(t)
    setResolvedTheme(r)
    applyTheme(r)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
