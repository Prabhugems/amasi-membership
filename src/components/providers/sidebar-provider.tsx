"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

interface SidebarContextValue {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggle: () => void
}

const SidebarContext = createContext<SidebarContextValue>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
})

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    try {
      const stored = localStorage.getItem("sidebar-collapsed")
      if (stored === "true") setCollapsedState(true)
    } catch {
      // localStorage blocked (Android in-app webviews, Safari private, 3p-cookie policy).
      // Defaults are fine — just skip restore.
    }
    setMounted(true)
  }, [])

  const setCollapsed = (v: boolean) => {
    setCollapsedState(v)
    try {
      localStorage.setItem("sidebar-collapsed", String(v))
    } catch {}
  }

  const toggle = () => setCollapsed(!collapsed)

  // Prevent hydration mismatch — render default (expanded) until mounted
  return (
    <SidebarContext.Provider value={{ collapsed: mounted ? collapsed : false, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar() {
  return useContext(SidebarContext)
}
