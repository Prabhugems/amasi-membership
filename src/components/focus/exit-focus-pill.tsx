"use client"

import { X } from "lucide-react"
import { useFocusMode } from "@/components/providers/focus-mode-provider"

export function ExitFocusPill() {
  const { isFocusMode, exit } = useFocusMode()
  if (!isFocusMode) return null
  return (
    <button
      type="button"
      onClick={exit}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 inline-flex items-center gap-2 rounded-full bg-slate-900/90 dark:bg-slate-100/90 backdrop-blur-sm px-4 py-2 text-xs font-medium text-white dark:text-slate-900 shadow-lg hover:bg-slate-900 dark:hover:bg-slate-100 transition"
    >
      <X className="h-3.5 w-3.5" /> Exit focus mode
      <kbd className="ml-1 px-1 py-0.5 text-[10px] font-mono rounded bg-white/15 dark:bg-slate-900/15">Esc</kbd>
    </button>
  )
}
