"use client"

import { Clock, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import { PRIORITY_CONFIG } from "../lib/constants"
import type { SupportTicket } from "../lib/types"
import { timeAgo, waitingTime, hasUnreadMemberReply, lastMessagePreview } from "../lib/ticket-utils"
import { StatusBadge, SlaBadge } from "./TicketBadges"

export function TicketListItem({
  ticket,
  isSelected,
  onClick,
}: {
  ticket: SupportTicket
  isSelected: boolean
  onClick: () => void
}) {
  const priorityCfg = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.normal
  const unread = hasUnreadMemberReply(ticket)
  const preview = lastMessagePreview(ticket)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-l-[3px] transition-all duration-150 ${
        isSelected
          ? "bg-teal-50/80 border-l-teal-600 shadow-[inset_0_0_0_1px_rgba(13,148,136,0.08)]"
          : `${priorityCfg.borderColor} hover:bg-muted/50`
      } ${unread && !isSelected ? "bg-blue-50/40" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {unread && (
              <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0 animate-pulse" aria-hidden="true" />
            )}
            {unread && <span className="sr-only">Unread reply</span>}
            <p
              className={`text-[13px] truncate leading-tight ${
                unread ? "font-bold text-foreground" : "font-semibold text-foreground/90"
              }`}
            >
              {ticket.subject}
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground truncate">
              {ticket.name}
            </span>
            <span className="text-muted-foreground/40 text-[10px]">|</span>
            <span
              tabIndex={0}
              className="font-mono text-[10px] text-muted-foreground/60 hover:text-primary transition-colors cursor-pointer"
              title="Copy permalink"
              onClick={(e) => {
                e.stopPropagation()
                const url = `${window.location.origin}/support/${ticket.ticket_number}`
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(url).then(() => toast.success("Permalink copied")).catch(() => toast.error("Copy failed"))
                } else {
                  toast.error("Copy not available (requires HTTPS)")
                }
              }}
            >
              {ticket.ticket_number}
            </span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0 pt-0.5">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {timeAgo(ticket.created_at)}
          </span>
          <StatusBadge status={ticket.status} />
        </div>
      </div>
      {/* Last message preview */}
      <p className="text-[11px] text-muted-foreground/70 mt-1.5 line-clamp-1 leading-snug">
        {preview}
      </p>
      {/* Bottom meta */}
      <div className="flex items-center gap-2 mt-1.5">
        {ticket.priority === "urgent" && (
          <span className="text-[9px] font-bold text-red-600 bg-red-50 dark:bg-red-500/15 px-1.5 py-0.5 rounded uppercase tracking-wider">
            Urgent
          </span>
        )}
        {ticket.priority === "high" && (
          <span className="text-[9px] font-bold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 px-1.5 py-0.5 rounded uppercase tracking-wider">
            High
          </span>
        )}
        <SlaBadge ticket={ticket} />
        {(ticket.status === "open" || ticket.status === "in_progress") && (
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {waitingTime(ticket.created_at)}
          </span>
        )}
        {ticket.replies && ticket.replies.length > 0 && (
          <span className="text-[10px] text-muted-foreground/60 flex items-center gap-0.5 ml-auto">
            <MessageSquare className="h-2.5 w-2.5" />
            {ticket.replies.length}
          </span>
        )}
      </div>
    </button>
  )
}
