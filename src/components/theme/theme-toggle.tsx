"use client"

import { useEffect, useRef, useState } from "react"
import { Moon, Sun, MonitorSmartphone } from "lucide-react"
import { motion, AnimatePresence, useReducedMotion } from "framer-motion"
import { useTheme, type Theme } from "@/components/providers/theme-provider"
import { cn } from "@/lib/utils"

const THEMES: Array<{ value: Theme; label: string; Icon: typeof Sun }> = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: MonitorSmartphone },
]

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const reduced = useReducedMotion()
  const TriggerIcon = resolvedTheme === "dark" ? Moon : Sun

  useEffect(() => {
    if (!open) return
    function handlePointer(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handlePointer)
    document.addEventListener("keydown", handleKey)
    return () => {
      document.removeEventListener("mousedown", handlePointer)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className={cn(
          "inline-flex items-center justify-center rounded-full h-9 w-9 text-slate-600 hover:bg-slate-100 transition",
          "dark:text-slate-300 dark:hover:bg-slate-800",
          className
        )}
        aria-label="Change theme"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={resolvedTheme}
            initial={reduced ? { opacity: 0 } : { rotate: -90, opacity: 0, scale: 0.8 }}
            animate={reduced ? { opacity: 1 } : { rotate: 0, opacity: 1, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { rotate: 90, opacity: 0, scale: 0.8 }}
            transition={reduced ? { duration: 0 } : { duration: 0.3, ease: "easeInOut" }}
            className="inline-flex"
          >
            <TriggerIcon className="h-4 w-4" />
          </motion.span>
        </AnimatePresence>
      </button>
      {open && (
        <div
          role="menu"
          className={cn(
            "absolute right-0 mt-2 w-40 z-50 rounded-md border bg-white p-1 shadow-md",
            "dark:bg-slate-900 dark:border-slate-700"
          )}
        >
          {THEMES.map(({ value, label, Icon }) => {
            const active = theme === value
            return (
              <button
                key={value}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => {
                  setTheme(value)
                  setOpen(false)
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer",
                  "text-slate-700 hover:bg-slate-100",
                  "dark:text-slate-200 dark:hover:bg-slate-800",
                  active && "text-primary font-medium"
                )}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
                {active && <span className="ml-auto text-xs">&#10003;</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
