"use client"

import { Maximize2, Minimize2 } from "lucide-react"
import { useFocusMode } from "@/components/providers/focus-mode-provider"
import { cn } from "@/lib/utils"

export function FocusToggle({ className }: { className?: string }) {
  const { isFocusMode, toggle } = useFocusMode()
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex items-center justify-center rounded-full h-9 w-9 text-slate-600 hover:bg-slate-100 transition",
        "dark:text-slate-300 dark:hover:bg-slate-800",
        className
      )}
      aria-label={isFocusMode ? "Exit focus mode" : "Enter focus mode (Shift+F)"}
      title={isFocusMode ? "Exit focus mode" : "Focus mode (Shift+F)"}
    >
      {isFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
    </button>
  )
}
