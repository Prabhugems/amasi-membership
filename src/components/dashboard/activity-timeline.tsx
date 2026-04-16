"use client"

import Link from "next/link"
import { type JSX } from "react"
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CheckCircle2,
  IndianRupee,
  Settings,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"

export type ActivityEventType =
  | "application_submitted"
  | "auto_approved"
  | "approved"
  | "rejected"
  | "needs_review"
  | "nmc_verified"
  | "nmc_skipped"
  | "payment_received"
  | "system"

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  title: string
  subtitle?: string
  timestamp: string
  href?: string
}

export interface ActivityTimelineProps {
  events: ActivityEvent[]
  loading?: boolean
  maxVisible?: number
}

const EVENT_STYLES: Record<
  ActivityEventType,
  { icon: LucideIcon; color: string }
> = {
  application_submitted: {
    icon: UserPlus,
    color: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  },
  auto_approved: {
    icon: Zap,
    color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  approved: {
    icon: CheckCircle2,
    color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  rejected: {
    icon: XCircle,
    color: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400",
  },
  needs_review: {
    icon: AlertCircle,
    color: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  },
  nmc_verified: {
    icon: ShieldCheck,
    color: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400",
  },
  nmc_skipped: {
    icon: ShieldAlert,
    color: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400",
  },
  payment_received: {
    icon: IndianRupee,
    color: "bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400",
  },
  system: {
    icon: Settings,
    color: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-400",
  },
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 4) return `${weeks}w ago`
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

export function ActivityTimeline({
  events,
  loading = false,
  maxVisible = 6,
}: ActivityTimelineProps): JSX.Element {
  if (loading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 animate-pulse" />
            <div className="flex-1 space-y-1.5 pt-1">
              <div className="h-3 w-2/3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
              <div className="h-2.5 w-1/3 bg-slate-100 dark:bg-slate-800 rounded animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className="py-8 flex flex-col items-center gap-2 text-center">
        <div className="h-10 w-10 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
          <Activity className="h-4 w-4 text-slate-400 dark:text-slate-500" />
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-400">No recent activity</p>
      </div>
    )
  }

  const visible = events.slice(0, maxVisible)

  return (
    <div className="relative">
      <div
        className="absolute left-[18px] top-2 bottom-2 w-px bg-slate-200 dark:bg-slate-800 draw-line"
        aria-hidden="true"
      />
      <div className="space-y-4">
        {visible.map((event) => {
          const { icon: Icon, color } = EVENT_STYLES[event.type]
          const hasHref = !!event.href
          const content = (
            <div className="flex gap-3 relative">
              <div
                className={cn(
                  "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white dark:border-slate-900",
                  color
                )}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0 pt-0.5">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100 leading-snug">
                  {event.title}
                </p>
                {event.subtitle && (
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {event.subtitle}
                  </p>
                )}
                <p className="text-[11px] text-slate-400 dark:text-slate-400 mt-1 tabular-nums">
                  {relativeTime(event.timestamp)}
                </p>
              </div>
              {hasHref && (
                <ArrowUpRight
                  aria-hidden="true"
                  className="absolute top-0.5 right-0 h-3 w-3 text-slate-400 dark:text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity duration-150"
                />
              )}
            </div>
          )

          if (event.href) {
            return (
              <Link
                key={event.id}
                href={event.href}
                className="block group -mx-2 px-2 py-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800/50 transition"
              >
                {content}
              </Link>
            )
          }

          return <div key={event.id}>{content}</div>
        })}
      </div>
    </div>
  )
}
