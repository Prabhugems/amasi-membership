"use client"

import { useEffect, useState, type ComponentType, type JSX } from "react"
import { motion } from "framer-motion"
import { Moon, Sun, Sunrise } from "lucide-react"
import { cn } from "@/lib/utils"

interface DashboardHeaderProps {
  adminName?: string
  children?: React.ReactNode
  /** Fallback single-string context line (used when `contextPills` not provided). */
  contextLine?: string
  /** Stagger-animated pills shown under the date line. Takes precedence over contextLine. */
  contextPills?: string[]
  /** Pending application count — when > 0 renders a pulsing amber "N applications waiting" line. */
  pendingCount?: number
  /** When true, show a small pulsing dot next to the date indicating data is refreshing */
  isRefetching?: boolean
}

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}

type LucideIconLike = ComponentType<{ className?: string; strokeWidth?: number }>

interface TimeIcon {
  Icon: LucideIconLike
  gradient: string
}

function getTimeIcon(): TimeIcon {
  const hour = new Date().getHours()
  if (hour < 6) {
    // Night
    return {
      Icon: Moon,
      gradient: "bg-gradient-to-br from-indigo-500 to-violet-700 shadow-violet-500/20",
    }
  }
  if (hour < 12) {
    // Morning
    return {
      Icon: Sun,
      gradient: "bg-gradient-to-br from-amber-300 to-orange-500 shadow-orange-500/20",
    }
  }
  if (hour < 17) {
    // Afternoon (AMASI brand)
    return {
      Icon: Sun,
      gradient: "bg-gradient-to-br from-teal-400 to-emerald-600 shadow-emerald-500/20",
    }
  }
  if (hour < 20) {
    // Evening
    return {
      Icon: Sunrise,
      gradient: "bg-gradient-to-br from-orange-400 to-rose-500 shadow-rose-500/20",
    }
  }
  // Night
  return {
    Icon: Moon,
    gradient: "bg-gradient-to-br from-indigo-500 to-violet-700 shadow-violet-500/20",
  }
}

export function DashboardHeader(props: DashboardHeaderProps): JSX.Element {
  const { adminName, children, contextLine, contextPills, pendingCount, isRefetching } = props
  const resolvedName =
    !adminName || adminName === "Admin"
      ? "Admin"
      : adminName.charAt(0).toUpperCase() + adminName.slice(1)

  const [greeting, setGreeting] = useState("Welcome")
  const [today, setToday] = useState("")
  const [timeIcon, setTimeIcon] = useState<TimeIcon | null>(null)

  useEffect(() => {
    setGreeting(getGreeting())
    setTimeIcon(getTimeIcon())
    setToday(
      new Date().toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    )
  }, [])

  const Icon = timeIcon?.Icon
  const gradient = timeIcon?.gradient ?? "bg-gradient-to-br from-teal-500 to-emerald-600 shadow-emerald-500/20"

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "hidden sm:flex h-11 w-11 rounded-2xl items-center justify-center text-white shadow-sm",
            gradient
          )}
        >
          {Icon ? <Icon className="h-5 w-5" strokeWidth={2} /> : null}
        </div>
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight text-slate-900 dark:text-slate-100 leading-none">
            {greeting}, {resolvedName}
          </h1>
          <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1.5 inline-flex items-center gap-2">
            <span>{today ? `${today} · AMASI Membership Portal` : "AMASI Membership Portal"}</span>
            {isRefetching && (
              <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span>Syncing…</span>
              </span>
            )}
          </p>
          {contextPills && contextPills.length > 0 ? (
            <p className="text-[12px] font-medium text-slate-600 dark:text-slate-400 mt-1.5 inline-flex items-center gap-2 flex-wrap">
              <span className="inline-block w-1 h-1 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              {contextPills.map((pill, i) => (
                <span key={pill} className="inline-flex items-center gap-2">
                  {i > 0 && <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">·</span>}
                  <motion.span
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.4 + i * 0.12, ease: "easeOut" }}
                  >
                    {pill}
                  </motion.span>
                </span>
              ))}
            </p>
          ) : contextLine ? (
            <p className="text-[12px] font-medium text-slate-600 dark:text-slate-400 mt-1.5 inline-flex items-center gap-2">
              <span className="inline-block w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />
              {contextLine}
            </p>
          ) : null}
          {pendingCount !== undefined && pendingCount > 0 && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.2, ease: "easeOut" }}
              className="inline-flex items-center gap-1.5 mt-1 text-xs font-medium text-amber-600 dark:text-amber-400"
            >
              <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-400" />
              </span>
              {pendingCount} application{pendingCount === 1 ? "" : "s"} waiting for your review
            </motion.div>
          )}
        </div>
      </div>
      {children ? (
        <div className="flex items-center gap-3">{children}</div>
      ) : null}
    </div>
  )
}
