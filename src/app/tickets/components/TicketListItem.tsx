"use client"

import { Clock, MessageSquare } from "lucide-react"
import { toast } from "sonner"
import type { SupportTicket } from "../lib/types"
import { timeAgo, waitingTime, hasUnreadMemberReply, lastMessagePreview } from "../lib/ticket-utils"
import { StatusBadge, PriorityBadge, SlaBadge } from "./TicketBadges"

export function TicketListItem({
  ticket,
  isSelected,
  onClick,
}: {
  ticket: SupportTicket
  isSelected: boolean
  onClick: () => void
}) {
  const unread = hasUnreadMemberReply(ticket)
  const preview = lastMessagePreview(ticket)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 border-b border-border transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {unread && (
              <span className="h-2 w-2 rounded-full bg-primary shrink-0" aria-hidden="true" />
            )}
            {unread && <span className="sr-only">Unread reply</span>}
            <p className={`text-[13px] truncate leading-tight ${unread ? "font-bold text-foreground" : "font-semibold text-foreground/90"}`}>
              {ticket.subject}
            </p>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="text-xs text-muted-foreground truncate">{ticket.name}</span>
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

      <p className="text-[11px] text-muted-foreground/70 mt-1.5 line-clamp-1 leading-snug">
        {preview}
      </p>

      <div className="flex items-center gap-3 mt-1.5">
        {(ticket.priority === "urgent" || ticket.priority === "high") && (
          <PriorityBadge priority={ticket.priority} />
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
