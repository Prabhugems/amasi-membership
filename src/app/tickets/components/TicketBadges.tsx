"use client"

import { Badge } from "@/components/ui/badge"
import { STATUS_CONFIG, PRIORITY_CONFIG } from "../lib/constants"
import type { SupportTicket } from "../lib/types"
import { getSlaStatus } from "../lib/ticket-utils"

export function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor} mr-1.5`} aria-hidden="true" />
      {cfg.label}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}
    >
      {cfg.label}
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
  // Hide for closed/resolved tickets unless breached
  if (
    (ticket.status === "resolved" || ticket.status === "closed") &&
    sla.type !== "breached"
  )
    return null

  if (sla.type === "breached" && (ticket.status === "open" || ticket.status === "in_progress")) {
    return (
      <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200">
        {sla.label}
      </span>
    )
  }
  if (sla.type === "warning") {
    return (
      <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">
        {sla.label}
      </span>
    )
  }
  if (sla.type === "responded") {
    return (
      <span className="inline-flex items-center text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">
        {sla.label}
      </span>
    )
  }
  return null
}
