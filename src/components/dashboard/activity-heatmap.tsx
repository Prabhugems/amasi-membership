"use client"

import { useEffect, useMemo, type JSX } from "react"
import { motion, useMotionValue, useTransform, animate } from "framer-motion"
import { useIsDark } from "@/hooks/use-is-dark"

export interface ActivityHeatmapData {
  counts: Record<string, number>
}

export interface ActivityHeatmapProps {
  data: ActivityHeatmapData
  color?: string
  title?: string
  subtitle?: string
  loading?: boolean
}

const CELL_SIZE = 10
const CELL_GAP = 2

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function parseHex(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "")
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  }
}

function cellRgba(count: number, max: number, rgb: { r: number; g: number; b: number }): string | undefined {
  if (count === 0) return undefined
  const ratio = count / (max || 1)
  let opacity = 0.25
  if (ratio > 0.75) opacity = 1
  else if (ratio > 0.5) opacity = 0.7
  else if (ratio > 0.25) opacity = 0.45
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity})`
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function ActivityHeatmap({
  data,
  color = "#10b981",
  title = "Application activity",
  subtitle,
  loading = false,
}: ActivityHeatmapProps): JSX.Element {
  const isDark = useIsDark()
  const { weeks, monthMarkers, total, max } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const end = new Date(today)
    const start = new Date(today)
    start.setDate(start.getDate() - 364)
    while (start.getDay() !== 0) start.setDate(start.getDate() - 1)

    const cols: Array<Array<{ date: string; count: number; dow: number } | null>> = []
    let cur = new Date(start)
    let currentCol: Array<{ date: string; count: number; dow: number } | null> = []

    while (cur <= end) {
      const key = isoDate(cur)
      const count = data.counts[key] ?? 0
      currentCol.push({ date: key, count, dow: cur.getDay() })
      if (cur.getDay() === 6) {
        while (currentCol.length < 7) currentCol.push(null)
        cols.push(currentCol)
        currentCol = []
      }
      cur.setDate(cur.getDate() + 1)
    }
    if (currentCol.length > 0) {
      while (currentCol.length < 7) currentCol.push(null)
      cols.push(currentCol)
    }

    const markers: Array<{ label: string; colIdx: number }> = []
    let lastMonth = -1
    cols.forEach((col, i) => {
      const first = col.find((c) => c !== null)
      if (!first) return
      const m = new Date(first.date).getMonth()
      if (m !== lastMonth) {
        markers.push({ label: MONTH_LABELS[m], colIdx: i })
        lastMonth = m
      }
    })

    let totalCount = 0
    let maxCount = 0
    for (const col of cols) {
      for (const c of col) {
        if (!c) continue
        totalCount += c.count
        if (c.count > maxCount) maxCount = c.count
      }
    }

    return { weeks: cols, monthMarkers: markers, total: totalCount, max: maxCount }
  }, [data])

  const rgb = parseHex(color)

  // Count-up for the "{total} in the last year" label — mirrors StatCard's animate() pattern.
  const totalMv = useMotionValue(0)
  const totalRounded = useTransform(totalMv, (v) => Math.round(v).toLocaleString("en-IN"))
  useEffect(() => {
    const controls = animate(totalMv, total, {
      duration: 1.0,
      ease: "easeOut",
      delay: 0.5,
    })
    return () => controls.stop()
  }, [total, totalMv])

  if (loading) {
    return (
      <div className="space-y-2">
        <div className="h-4 w-40 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
        <div className="h-24 w-full bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-700 rounded-lg animate-pulse" />
      </div>
    )
  }

  const gridWidth = weeks.length * (CELL_SIZE + CELL_GAP)

  return (
    <div>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <div>
          {title && <h2 className="text-[15px] font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
          {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
        </div>
        <div className="flex items-baseline gap-1.5 ml-auto">
          <motion.span className="text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
            {totalRounded}
          </motion.span>
          <span className="text-xs text-slate-500 dark:text-slate-400">in the last year</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ width: gridWidth, minWidth: gridWidth }}>
          {/* Month labels */}
          <div className="relative h-4 mb-1" aria-hidden="true">
            {monthMarkers.map(({ label, colIdx }) => (
              <span
                key={`${label}-${colIdx}`}
                className="absolute text-[10px] text-slate-500 dark:text-slate-400 font-medium"
                style={{ left: `${colIdx * (CELL_SIZE + CELL_GAP)}px` }}
              >
                {label}
              </span>
            ))}
          </div>

          {/* Grid */}
          <div className="flex" style={{ gap: `${CELL_GAP}px` }}>
            {weeks.map((col, ci) => (
              <div key={ci} className="flex flex-col" style={{ gap: `${CELL_GAP}px` }}>
                {col.map((day, di) => {
                  if (!day) {
                    return (
                      <span
                        key={di}
                        className="rounded-sm"
                        style={{ width: CELL_SIZE, height: CELL_SIZE, backgroundColor: "transparent" }}
                      />
                    )
                  }
                  const bg = cellRgba(day.count, max, rgb)
                  const labelDate = new Date(day.date).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                  const tooltipText =
                    day.count === 0
                      ? `No submissions · ${labelDate}`
                      : `${day.count} submission${day.count === 1 ? "" : "s"} · ${labelDate}`
                  return (
                    <div key={di} className="relative group" style={{ width: CELL_SIZE, height: CELL_SIZE }}>
                      <span
                        className="block rounded-sm w-full h-full"
                        style={{
                          backgroundColor: bg ?? (isDark ? "#1e293b" : "#f1f5f9"),
                        }}
                      />
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:block z-20 bg-popover border border-border rounded-lg px-2.5 py-1.5 text-xs text-popover-foreground whitespace-nowrap shadow-sm"
                      >
                        {tooltipText}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mt-3 ml-auto w-fit">
        <span>Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((r, i) => (
          <span
            key={i}
            className="rounded-sm"
            style={{
              width: CELL_SIZE,
              height: CELL_SIZE,
              backgroundColor:
                r === 0 ? (isDark ? "#1e293b" : "#f1f5f9") : `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${r === 0.25 ? 0.25 : r === 0.5 ? 0.45 : r === 0.75 ? 0.7 : 1})`,
            }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}
