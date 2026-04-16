"use client"

import { type LucideIcon, TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { motion, useMotionValue, useTransform, animate } from "framer-motion"
import { useEffect } from "react"
import { cn } from "@/lib/utils"

export type StatCardVariant = "default" | "hero" | "dark"

export type StatCardAccent = "emerald" | "blue" | "amber" | "violet" | "rose" | "sky" | "teal"

interface StatCardProps {
  title: string
  value: string | number
  description?: string
  icon: LucideIcon
  trend?: { value: string; positive: boolean }
  iconClassName?: string
  sparklineData?: number[]
  variant?: StatCardVariant
  accent?: StatCardAccent
  href?: string
  /** While the query is loading, swap value + description for pulsing skeleton blocks. */
  loading?: boolean
  /** After loading, if there's no data, show "—" and the description instead of count-up. */
  empty?: boolean
  /** When true, card border pulses amber to demand attention (e.g., pending count > 0). */
  pulse?: boolean
  /** When true, render a subtle ArrowUpRight indicator in the top-right corner on hover. */
  showHoverArrow?: boolean
}

const ACCENT_RGB: Record<StatCardAccent, [number, number, number]> = {
  emerald: [52, 211, 153],
  teal: [45, 212, 191],
  blue: [96, 165, 250],
  sky: [56, 189, 248],
  amber: [251, 191, 36],
  violet: [167, 139, 250],
  rose: [251, 113, 133],
}

const ACCENT_ICON_DEFAULT: Record<StatCardAccent, string> = {
  emerald: "bg-gradient-to-br from-emerald-400 to-emerald-600 text-white shadow-sm shadow-emerald-500/25",
  teal: "bg-gradient-to-br from-teal-400 to-teal-600 text-white shadow-sm shadow-teal-500/25",
  blue: "bg-gradient-to-br from-blue-400 to-blue-600 text-white shadow-sm shadow-blue-500/25",
  sky: "bg-gradient-to-br from-sky-400 to-sky-600 text-white shadow-sm shadow-sky-500/25",
  amber: "bg-gradient-to-br from-amber-400 to-amber-600 text-white shadow-sm shadow-amber-500/25",
  violet: "bg-gradient-to-br from-violet-400 to-violet-600 text-white shadow-sm shadow-violet-500/25",
  rose: "bg-gradient-to-br from-rose-400 to-rose-600 text-white shadow-sm shadow-rose-500/25",
}

const ACCENT_ICON_DARK: Record<StatCardAccent, string> = {
  emerald: "bg-gradient-to-br from-emerald-500 to-emerald-700 text-white",
  teal: "bg-gradient-to-br from-teal-500 to-teal-700 text-white",
  blue: "bg-gradient-to-br from-blue-500 to-blue-700 text-white",
  sky: "bg-gradient-to-br from-sky-500 to-sky-700 text-white",
  amber: "bg-gradient-to-br from-amber-500 to-amber-700 text-white",
  violet: "bg-gradient-to-br from-violet-500 to-violet-700 text-white",
  rose: "bg-gradient-to-br from-rose-500 to-rose-700 text-white",
}

// --- inline helper to parse value ---
// If value is a number, count up from 0.
// If it's a string like "18,021" → parse to number → count up → format as "18,021"
// If it's a string like "₹9,090" → detect prefix "₹", parse number, count up, reformat with prefix
// If it's a string with no numbers (e.g. "—"), just render as-is (no animation)
function parseStringValue(s: string): { prefix: string; num: number; formatter: (n: number) => string } | null {
  const match = s.match(/^(\D*?)([\d,]+(?:\.\d+)?)(\D*)$/)
  if (!match) return null
  const prefix = match[1] || ""
  const suffix = match[3] || ""
  const numStr = match[2].replace(/,/g, "")
  const num = parseFloat(numStr)
  if (!Number.isFinite(num)) return null
  return {
    prefix,
    num,
    formatter: (n: number) => `${prefix}${Math.round(n).toLocaleString("en-IN")}${suffix}`,
  }
}

function CountUpValue({ value, className }: { value: string | number; className?: string }) {
  if (typeof value === "string") {
    const parsed = parseStringValue(value)
    if (!parsed) {
      return <p className={className}>{value}</p>
    }
    return <AnimatedNumber target={parsed.num} formatter={parsed.formatter} className={className} />
  }
  if (typeof value === "number") {
    return <AnimatedNumber target={value} formatter={(n) => Math.round(n).toLocaleString("en-IN")} className={className} />
  }
  return <p className={className}>{String(value)}</p>
}

function AnimatedNumber({ target, formatter, className }: { target: number; formatter: (n: number) => string; className?: string }) {
  const mv = useMotionValue(0)
  const rounded = useTransform(mv, (v) => formatter(v))
  useEffect(() => {
    const controls = animate(mv, target, {
      duration: 0.8,
      ease: [0.22, 1, 0.36, 1],
      delay: 0.15,
    })
    return () => controls.stop()
  }, [target, mv])
  return <motion.p className={className}>{rounded}</motion.p>
}

function Sparkline({ data, color = "#94a3b8" }: { data: number[]; color?: string }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const w = 60
  const h = 20
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w
      const y = h - ((v - min) / range) * (h - 4) - 2
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="opacity-50">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

const VARIANT_STYLES: Record<
  StatCardVariant,
  {
    card: string
    label: string
    value: string
    iconWrap: string
    iconColor: string
    trendPositive: string
    trendNegative: string
    descText: string
    dotSep: string
    sparklineColor: (positive: boolean | undefined) => string
  }
> = {
  default: {
    card: "bg-white border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_4px_rgba(15,23,42,0.03)] hover:shadow-[0_2px_4px_rgba(15,23,42,0.06),0_8px_16px_rgba(15,23,42,0.04)] dark:bg-slate-900 dark:border-slate-800/70 dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_2px_4px_rgba(0,0,0,0.3)]",
    label: "text-slate-500 dark:text-slate-400",
    value: "text-slate-900 dark:text-slate-100",
    iconWrap: "bg-blue-50 dark:bg-blue-500/15",
    iconColor: "text-blue-600 dark:text-blue-400",
    trendPositive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
    trendNegative: "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    descText: "text-slate-500 dark:text-slate-400",
    dotSep: "text-slate-300 dark:text-slate-600",
    sparklineColor: (p) => (p === true ? "#10b981" : p === false ? "#ef4444" : "#94a3b8"),
  },
  hero: {
    card: "bg-gradient-to-br from-teal-500 to-emerald-600 border border-emerald-500/20 shadow-[0_4px_12px_rgba(16,185,129,0.24),0_2px_4px_rgba(16,185,129,0.12)] hover:shadow-[0_8px_24px_rgba(16,185,129,0.28)]",
    label: "text-white/85",
    value: "text-white",
    iconWrap: "bg-white/20 backdrop-blur-sm",
    iconColor: "text-white",
    trendPositive: "bg-white/25 text-white",
    trendNegative: "bg-white/25 text-white",
    descText: "text-white/80",
    dotSep: "text-white/40",
    sparklineColor: () => "rgba(255,255,255,0.7)",
  },
  dark: {
    card: "bg-white border border-slate-200/70 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_2px_4px_rgba(15,23,42,0.03)] hover:shadow-[0_4px_12px_rgba(15,23,42,0.08)] dark:bg-gradient-to-br dark:from-slate-800 dark:to-slate-900 dark:border-slate-700/50 dark:shadow-[0_4px_12px_rgba(15,23,42,0.12),0_2px_4px_rgba(15,23,42,0.08)] dark:hover:shadow-[0_8px_24px_rgba(15,23,42,0.18)]",
    label: "text-slate-500 dark:text-slate-400",
    value: "text-slate-900 dark:text-white",
    iconWrap: "bg-white/10 dark:bg-white/10",
    iconColor: "text-white dark:text-white",
    trendPositive: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300",
    trendNegative: "bg-red-50 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    descText: "text-slate-500 dark:text-slate-400",
    dotSep: "text-slate-300 dark:text-slate-600",
    sparklineColor: (p) => (p === true ? "#10b981" : p === false ? "#ef4444" : "#94a3b8"),
  },
}

export function StatCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  iconClassName,
  sparklineData,
  variant = "default",
  accent,
  href,
  loading = false,
  empty = false,
  pulse = false,
  showHoverArrow = false,
}: StatCardProps) {
  const styles = VARIANT_STYLES[variant]
  const hasSparkline = sparklineData && sparklineData.length > 1
  const sparklineColor = styles.sparklineColor(trend?.positive)
  const [ar, ag, ab] = ACCENT_RGB[accent ?? "emerald"]

  // Resolve the icon badge classes based on variant + accent
  let resolvedIconClass: string
  if (variant === "hero") {
    resolvedIconClass = `${styles.iconWrap} ${styles.iconColor}`
  } else if (variant === "dark") {
    resolvedIconClass = accent
      ? ACCENT_ICON_DARK[accent]
      : `${styles.iconWrap} ${styles.iconColor}`
  } else {
    resolvedIconClass = iconClassName
      ? iconClassName
      : accent
        ? ACCENT_ICON_DEFAULT[accent]
        : `${styles.iconWrap} ${styles.iconColor}`
  }

  // Colored accent strip along the top edge of non-hero cards
  const topAccentStyle =
    variant !== "hero" && accent
      ? {
          background: `linear-gradient(90deg, rgba(${ar},${ag},${ab},0) 0%, rgba(${ar},${ag},${ab},0.8) 50%, rgba(${ar},${ag},${ab},0) 100%)`,
        }
      : undefined

  const cardContent = (
    <div
      role="group"
      aria-label={title}
      className={cn(
        "relative rounded-2xl p-6 transition-all overflow-hidden card-lift",
        styles.card,
        pulse && "!border-amber-500/50 animate-[pending-pulse_2s_ease-in-out_infinite]"
      )}
    >
      {topAccentStyle && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 left-0 right-0 h-[2px]"
          style={topAccentStyle}
        />
      )}
      {variant === "hero" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-12 -right-12 h-40 w-40 rounded-full glow-breathe glow-breathe-1"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 65%)",
          }}
        />
      )}
      {variant === "hero" && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-16 -left-8 h-48 w-48 rounded-full glow-breathe glow-breathe-3"
          style={{
            background: "radial-gradient(circle, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 70%)",
          }}
        />
      )}
      {variant === "hero" && <div className="hero-shimmer" aria-hidden="true" />}
      {variant === "dark" && (
        <>
          {/* Large radial glow — tinted by accent, breathes continuously */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full glow-breathe glow-breathe-2"
            style={{
              background: `radial-gradient(circle, rgba(${ar},${ag},${ab},0.45) 0%, rgba(${ar},${ag},${ab},0) 65%)`,
            }}
          />
          {/* Secondary smaller glow bottom-left for depth */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-16 -left-12 h-40 w-40 rounded-full glow-breathe glow-breathe-4"
            style={{
              background: `radial-gradient(circle, rgba(${ar},${ag},${ab},0.20) 0%, rgba(${ar},${ag},${ab},0) 70%)`,
            }}
          />
        </>
      )}
      {variant === "default" && accent && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full glow-breathe glow-breathe-2"
          style={{
            background: `radial-gradient(circle, rgba(${ar},${ag},${ab},0.14) 0%, rgba(${ar},${ag},${ab},0) 70%)`,
          }}
        />
      )}
      {/* Hover arrow indicator (shown when wrapping Link is hovered) */}
      {showHoverArrow && href && (
        <ArrowUpRight
          aria-hidden="true"
          className={cn(
            "absolute top-3 right-3 h-3.5 w-3.5 z-20 opacity-0 transition-opacity duration-150 group-hover:opacity-60",
            variant === "hero" ? "text-white" : "text-slate-500 dark:text-slate-400"
          )}
        />
      )}
      {/* Top row: label left, icon top-right. Trend pill absolute corner. */}
      <div className="relative z-10 flex items-start justify-between mb-5">
        <p
          className={cn(
            "text-[11px] font-semibold uppercase tracking-[0.1em]",
            styles.label
          )}
        >
          {title}
        </p>
        <div
          className={cn(
            "h-11 w-11 rounded-xl flex items-center justify-center shrink-0",
            resolvedIconClass
          )}
        >
          <Icon className="h-[22px] w-[22px]" strokeWidth={1.75} />
        </div>
      </div>

      {loading ? (
        <div className="relative z-10 mt-1 space-y-2">
          <div className="h-8 w-24 rounded-md bg-slate-200/80 dark:bg-white/10 animate-pulse" />
          <div className="h-3 w-16 rounded-md bg-slate-200/60 dark:bg-white/5 animate-pulse" />
        </div>
      ) : empty ? (
        <>
          <p className={cn(
            "relative z-10 text-[34px] font-display font-semibold tracking-tight tabular-nums leading-none mb-3",
            styles.value
          )}>
            —
          </p>
          <div className="relative z-10 flex items-end justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              {description && (
                <span className={cn("text-xs truncate", styles.descText)}>
                  {description}
                </span>
              )}
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Big value */}
          <CountUpValue
            value={value}
            className={cn(
              "relative z-10 text-[34px] font-display font-semibold tracking-tight tabular-nums leading-none mb-3",
              styles.value
            )}
          />

          {/* Bottom row */}
          <div className="relative z-10 flex items-end justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              {trend && (
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                    trend.positive ? styles.trendPositive : styles.trendNegative
                  )}
                >
                  {trend.positive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {trend.value}
                </span>
              )}
              {trend && description && (
                <span className={styles.dotSep}>·</span>
              )}
              {description && (
                <span className={cn("text-xs truncate", styles.descText)}>
                  {description}
                </span>
              )}
            </div>
            {hasSparkline && <Sparkline data={sparklineData} color={sparklineColor} />}
          </div>
        </>
      )}
    </div>
  )

  return href ? (
    <Link href={href} className="block group">
      {cardContent}
    </Link>
  ) : (
    cardContent
  )
}
