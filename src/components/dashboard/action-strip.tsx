import type { JSX } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface ActionStripProps {
  pendingCount: number
  oldestHours: number
  href?: string
}

function formatAge(hours: number): string {
  if (hours < 1) return "just now"
  if (hours < 24) return `${Math.round(hours)}h`
  const days = Math.floor(hours / 24)
  const remainingHours = Math.round(hours % 24)
  if (days < 7) return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
  return `${days} days`
}

export function ActionStrip({
  pendingCount,
  oldestHours,
  href = "/pending",
}: ActionStripProps): JSX.Element | null {
  if (pendingCount === 0) return null

  const isCritical = oldestHours >= 72
  const isWarning = oldestHours >= 24 && oldestHours < 72

  const containerClasses = cn(
    "flex items-center justify-between gap-4 rounded-2xl border px-5 py-4 transition",
    isCritical
      ? "border-red-200/80 bg-gradient-to-r from-red-50 via-red-50/80 to-rose-50/60 shadow-[0_1px_2px_rgba(239,68,68,0.12),0_0_0_1px_rgba(239,68,68,0.10)] dark:bg-red-500/10 dark:border-red-400/30 dark:from-red-500/10 dark:via-red-500/10 dark:to-rose-500/10"
      : isWarning
        ? "border-amber-300/80 bg-gradient-to-r from-amber-50 via-amber-100/70 to-orange-100/50 shadow-[0_1px_2px_rgba(245,158,11,0.16),0_0_0_1px_rgba(245,158,11,0.12)] dark:bg-amber-500/15 dark:border-amber-400/40"
        : "border-amber-200/60 bg-gradient-to-r from-amber-50 via-amber-50/80 to-orange-50/60 shadow-[0_1px_2px_rgba(245,158,11,0.08)] dark:bg-amber-500/10 dark:border-amber-400/30 dark:from-amber-500/10 dark:via-amber-500/10 dark:to-orange-500/10"
  )

  const iconBadgeClasses = cn(
    "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
    isCritical ? "bg-red-100 dark:bg-red-400/20" : "bg-amber-100 dark:bg-amber-400/20"
  )

  const iconClasses = cn(
    "h-4 w-4",
    isCritical ? "text-red-600 dark:text-red-300" : "text-amber-600 dark:text-amber-300"
  )

  const primaryClasses = cn(
    "text-sm font-semibold",
    isCritical ? "text-red-900 dark:text-red-100" : "text-amber-900 dark:text-amber-100"
  )

  const subClasses = cn(
    "text-xs mt-0.5",
    isCritical ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300"
  )

  const ctaClasses = cn(
    "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-semibold text-white shadow-sm transition shrink-0",
    isCritical
      ? "bg-red-900/90 hover:bg-red-900"
      : "bg-amber-900/90 hover:bg-amber-900"
  )

  const s = pendingCount

  return (
    <Link href={href} className={containerClasses} role="status">
      <div className="flex items-center gap-3 min-w-0">
        <div className={iconBadgeClasses}>
          <AlertTriangle className={iconClasses} aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <p className={primaryClasses}>
            {pendingCount} application{s !== 1 ? "s" : ""} need manual review
          </p>
          <p className={subClasses}>Oldest waiting {formatAge(oldestHours)}</p>
        </div>
      </div>
      <div className={ctaClasses}>
        Review queue
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </div>
    </Link>
  )
}
