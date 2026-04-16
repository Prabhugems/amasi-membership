"use client"

import type { JSX, KeyboardEvent } from "react"
import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

export type TimeRange = "today" | "7d" | "30d" | "90d"

interface TimeRangeTabsProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
  className?: string
}

const RANGES: ReadonlyArray<{ value: TimeRange; label: string }> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
]

export function TimeRangeTabs(props: TimeRangeTabsProps): JSX.Element {
  const { value, onChange, className } = props

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const delta = event.key === "ArrowRight" ? 1 : -1
    const nextIndex = (index + delta + RANGES.length) % RANGES.length
    const nextRange = RANGES[nextIndex]!.value
    onChange(nextRange)
    const container = event.currentTarget.parentElement
    const nextButton = container?.querySelectorAll<HTMLButtonElement>("button")[nextIndex]
    nextButton?.focus()
  }

  return (
    <div
      role="group"
      aria-label="Time range"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5",
        className,
      )}
    >
      {RANGES.map((range, index) => {
        const isActive = range.value === value
        return (
          <button
            key={range.value}
            type="button"
            aria-pressed={isActive}
            aria-label={range.label}
            onClick={() => onChange(range.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="relative px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
          >
            {isActive && (
              <motion.div
                layoutId="time-range-active-pill"
                className="absolute inset-0 rounded-md bg-background shadow-sm"
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
            <span
              className={cn(
                "relative z-10",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {range.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}
