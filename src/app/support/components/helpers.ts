import { formatDate } from "@/lib/utils"
import type { TicketAttachment } from "./types"

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

export function extractAttachment(message: string): { text: string; url: string | null; isImage: boolean } {
  const attachmentMatch = message.match(/\u{1F4CE} Attachment: (https?:\/\/\S+)/u)
  if (attachmentMatch) {
    const url = attachmentMatch[1]
    const text = message.replace(/\n?\n?\u{1F4CE} Attachment: https?:\/\/\S+/u, "").trim()
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url)
    return { text, url, isImage }
  }
  return { text: message, url: null, isImage: false }
}

export async function uploadTicketFile(file: File, storagePath: string): Promise<TicketAttachment | null> {
  try {
    const fd = new FormData()
    fd.append("file", file)
    fd.append("path", storagePath)
    const res = await fetch("/api/tickets/upload", { method: "POST", body: fd })
    if (!res.ok) return null
    const data = await res.json()
    return { url: data.url, filename: data.filename, size: data.size }
  } catch {
    return null
  }
}

export function statusBadgeVariant(status: string) {
  switch (status) {
    case "open":
      return "warning" as const
    case "in_progress":
      return "secondary" as const
    case "resolved":
      return "success" as const
    case "closed":
      return "outline" as const
    default:
      return "outline" as const
  }
}

export function statusLabel(status: string) {
  switch (status) {
    case "open":
      return "Open"
    case "in_progress":
      return "In Progress"
    case "resolved":
      return "Resolved"
    case "closed":
      return "Closed"
    default:
      return status
  }
}

export function timeAgo(dateStr: string) {
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
