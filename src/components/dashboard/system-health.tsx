"use client"

import type { JSX } from "react"
import { cn } from "@/lib/utils"

export type HealthStatus = "ok" | "degraded" | "down"

export type SystemHealthKey =
  | "nmc"
  | "email"
  | "razorpay"
  | "webhooks"
  | "email_delivery_24h"
  | "ocr_success_24h"
  | "drafts_stuck_24h"

export interface SystemHealthProps {
  health: {
    nmc: HealthStatus
    email: HealthStatus
    razorpay: HealthStatus
    webhooks: HealthStatus
    email_delivery_24h: HealthStatus
    ocr_success_24h: HealthStatus
    drafts_stuck_24h: HealthStatus
  }
  /** Override display label for specific pills (e.g. to embed computed values). */
  labels?: Partial<Record<SystemHealthKey, string>>
  onPillClick?: (key: SystemHealthKey) => void
}

interface PillConfig {
  key: SystemHealthKey
  label: string
}

const PILLS: readonly PillConfig[] = [
  { key: "nmc", label: "NMC API" },
  { key: "email", label: "Email" },
  { key: "razorpay", label: "Razorpay" },
  { key: "webhooks", label: "Webhooks" },
  { key: "email_delivery_24h", label: "Email delivery 24h" },
  { key: "ocr_success_24h", label: "OCR success 24h" },
  { key: "drafts_stuck_24h", label: "Drafts stuck >24h" },
] as const

const STATUS_TEXT: Record<HealthStatus, string> = {
  ok: "Healthy",
  degraded: "Degraded — investigate",
  down: "Down — action needed",
}

function StatusDot({ status }: { status: HealthStatus }): JSX.Element {
  if (status === "ok") {
    return (
      <span aria-hidden="true" className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
    )
  }

  if (status === "down") {
    return (
      <span aria-hidden="true" className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
      </span>
    )
  }

  return (
    <span
      aria-hidden="true"
      className="inline-block h-2 w-2 rounded-full bg-amber-500"
    />
  )
}

export function SystemHealth(props: SystemHealthProps): JSX.Element {
  const { health, labels, onPillClick } = props

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {PILLS.map(({ key, label }) => {
        const status: HealthStatus = health[key]
        const displayLabel = labels?.[key] ?? label
        const tooltip = `${displayLabel}: ${STATUS_TEXT[status]}`
        const ariaLabel = `${displayLabel}: ${status}`

        return (
          <button
            key={key}
            type="button"
            title={tooltip}
            aria-label={ariaLabel}
            onClick={onPillClick ? () => onPillClick(key) : undefined}
            className={cn(
              "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition",
              "border shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
              "hover:shadow-[0_2px_4px_rgba(15,23,42,0.08)]",
              {
                "bg-white border-emerald-200/70 text-emerald-700 hover:bg-emerald-50/50 dark:bg-slate-900 dark:border-emerald-400/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10":
                  status === "ok",
                "bg-white border-amber-200/70 text-amber-700 hover:bg-amber-50/50 dark:bg-slate-900 dark:border-amber-400/30 dark:text-amber-300 dark:hover:bg-amber-500/10":
                  status === "degraded",
                "bg-white border-red-200/70 text-red-700 hover:bg-red-50/50 dark:bg-slate-900 dark:border-red-400/30 dark:text-red-300 dark:hover:bg-red-500/10":
                  status === "down",
              }
            )}
          >
            <StatusDot status={status} />
            <span>{displayLabel}</span>
          </button>
        )
      })}
    </div>
  )
}
