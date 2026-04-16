"use client"

import { useEffect, useState, type JSX } from "react"
import { Keyboard, X } from "lucide-react"

interface Shortcut {
  keys: string[]
  label: string
}

interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

const SHORTCUTS: ShortcutGroup[] = [
  {
    title: "General",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["?"], label: "Show this keyboard help" },
      { keys: ["Esc"], label: "Close dialog / cancel action" },
      { keys: ["Shift", "F"], label: "Toggle focus mode" },
    ],
  },
  {
    title: "Navigation",
    items: [
      { keys: ["G", "D"], label: "Go to Dashboard" },
      { keys: ["G", "M"], label: "Go to All Members" },
      { keys: ["G", "P"], label: "Go to Pending" },
      { keys: ["G", "R"], label: "Go to Reports" },
      { keys: ["G", "T"], label: "Go to Tickets" },
      { keys: ["G", "A"], label: "Go to Audit log" },
    ],
  },
  {
    title: "Pending Applications",
    items: [
      { keys: ["A"], label: "Approve focused application" },
      { keys: ["R"], label: "Reject focused application" },
    ],
  },
]

export function ShortcutHelp(): JSX.Element | null {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ignore when typing in an input
      const target = e.target as HTMLElement | null
      const isEditable =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        (target?.isContentEditable ?? false)
      if (isEditable) return

      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault()
        setOpen((prev) => !prev)
      } else if (e.key === "Escape" && open) {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-[640px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/70 dark:border-slate-800/70 overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
              <Keyboard className="h-4 w-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Keyboard shortcuts</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">Press ? anywhere to toggle</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — 2 columns on desktop */}
        <div className="max-h-[70vh] overflow-y-auto p-6 grid gap-x-8 gap-y-6 md:grid-cols-2">
          {SHORTCUTS.map((group) => (
            <section key={group.title}>
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400 mb-3">
                {group.title}
              </h3>
              <ul className="space-y-2">
                {group.items.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 text-sm">
                    <span className="text-slate-700 dark:text-slate-300">{s.label}</span>
                    <KeyRow keys={s.keys} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 dark:border-slate-800 px-6 py-3 bg-slate-50/70 dark:bg-slate-800/30">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Tip — shortcuts are context-aware. <kbd className="px-1 py-0.5 rounded bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 font-mono">A</kbd> and <kbd className="px-1 py-0.5 rounded bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 font-mono">R</kbd> only work on the Pending page when an application is focused.
          </p>
        </div>
      </div>
    </div>
  )
}

function KeyRow({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-1 shrink-0">
      {keys.map((k, i) => (
        <span key={i} className="flex items-center gap-1">
          <kbd className="inline-flex items-center justify-center min-w-[22px] px-1.5 h-6 rounded-md bg-white border border-slate-200 dark:bg-slate-800 dark:border-slate-700 shadow-[0_1px_0_0_rgba(15,23,42,0.06)] text-[11px] font-mono font-medium text-slate-700 dark:text-slate-300">
            {k}
          </kbd>
          {i < keys.length - 1 && <span className="text-[10px] text-slate-400 dark:text-slate-500">then</span>}
        </span>
      ))}
    </span>
  )
}
