import { formatDate } from "@/lib/utils"
import type { SupportTicket } from "./types"

export function timeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatDate(dateStr)
}

export function waitingTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 60) return `${minutes}m`
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  return `${days}d ${hours % 24}h`
}

export function hasUnreadMemberReply(ticket: SupportTicket): boolean {
  if (!ticket.replies || ticket.replies.length === 0) return false
  const lastReply = ticket.replies[ticket.replies.length - 1]
  return !lastReply.is_admin
}

export function lastMessagePreview(ticket: SupportTicket): string {
  if (ticket.replies && ticket.replies.length > 0) {
    const last = ticket.replies[ticket.replies.length - 1]
    const prefix = last.is_admin ? "You: " : ""
    return prefix + last.message.replace(/\n/g, " ")
  }
  return ticket.description.replace(/\n/g, " ")
}

export function extractAttachment(message: string): { text: string; url: string | null; isImage: boolean } {
  const attachmentMatch = message.match(/📎 Attachment: (https?:\/\/\S+)/)
  if (attachmentMatch) {
    const url = attachmentMatch[1]
    const text = message.replace(/\n?\n?📎 Attachment: https?:\/\/\S+/, "").trim()
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url)
    return { text, url, isImage }
  }
  return { text: message, url: null, isImage: false }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(Math.abs(ms) / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

export function getSlaStatus(ticket: SupportTicket): {
  type: "breached" | "warning" | "responded" | "ok" | "none"
  label: string
} {
  if (!ticket.sla_due_at) return { type: "none", label: "" }
  if (ticket.first_response_at) return { type: "responded", label: "Responded" }
  if (ticket.sla_breached) return { type: "breached", label: "SLA Breached" }
  const remaining = new Date(ticket.sla_due_at).getTime() - Date.now()
  if (remaining <= 0) return { type: "breached", label: "SLA Breached" }
  if (remaining <= 60 * 60 * 1000) {
    return { type: "warning", label: `SLA: ${formatDuration(remaining)} left` }
  }
  return { type: "ok", label: "" }
}

export function applyTemplateVariables(text: string, ticket: SupportTicket | null): string {
  if (!ticket) return text
  return text
    .replace(/\{\{member_name\}\}/g, ticket.name || "")
    .replace(/\{\{ticket_number\}\}/g, ticket.ticket_number || "")
}

export function copyPermalink(ticketNumber: string): Promise<void> {
  const url = `${typeof window !== "undefined" ? window.location.origin : ""}/support/${ticketNumber}`
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard.writeText(url)
  }
  return Promise.reject(new Error("Clipboard not available"))
}
