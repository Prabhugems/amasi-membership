"use client"

import { Badge } from "@/components/ui/badge"
import { Clock } from "lucide-react"
import { STATUS_CONFIG, PRIORITY_CONFIG } from "../lib/constants"
import type { SupportTicket } from "../lib/types"
import { getSlaStatus } from "../lib/ticket-utils"

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor}`} aria-hidden="true" />
      <span className="lowercase">{cfg.label}</span>
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor}`} aria-hidden="true" />
      <span className="lowercase">{cfg.label}</span>
    </span>
  )
}

export function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="outline" className="capitalize text-[10px]">
      {category}
    </Badge>
  )
}

export function SlaBadge({ ticket }: { ticket: SupportTicket }) {
  const sla = getSlaStatus(ticket)
  if (sla.type === "none" || sla.type === "ok") return null
  if (
    (ticket.status === "resolved" || ticket.status === "closed") &&
    sla.type !== "breached"
  ) return null

  const tone =
    sla.type === "breached" && (ticket.status === "open" || ticket.status === "in_progress")
      ? "text-destructive"
      : sla.type === "warning"
      ? "text-amber-600"
      : sla.type === "responded"
      ? "text-emerald-600"
      : null
  if (!tone) return null

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${tone}`}>
      <Clock className="h-2.5 w-2.5" aria-hidden="true" />
      {sla.label}
    </span>
  )
}
