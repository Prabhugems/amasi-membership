"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { CommandPalette } from "./command-palette"

interface CommandPaletteContextValue {
  open: () => void
  close: () => void
  isOpen: boolean
}

const CommandPaletteContext = createContext<CommandPaletteContextValue | null>(null)

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = useContext(CommandPaletteContext)
  if (!ctx) throw new Error("useCommandPalette must be used inside CommandPaletteProvider")
  return ctx
}

export function CommandPaletteProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)

  const open = useCallback(() => setIsOpen(true), [])
  const close = useCallback(() => setIsOpen(false), [])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k"
      if (isCmdK) {
        e.preventDefault()
        setIsOpen((prev) => !prev)
        return
      }
      if (e.key === "Escape") {
        setIsOpen((prev) => (prev ? false : prev))
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <CommandPaletteContext.Provider value={{ open, close, isOpen }}>
      {children}
      <CommandPalette open={isOpen} onClose={close} />
    </CommandPaletteContext.Provider>
  )
}
