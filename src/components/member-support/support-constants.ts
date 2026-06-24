export const TICKET_CATEGORIES = [
  "Application Issue", "Profile Update", "Payment Issue",
  "Certificate/Card", "Technical Issue", "Other",
] as const

export const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
] as const

export type Priority = (typeof PRIORITIES)[number]["value"]

// Status dot colors use semantic Tailwind tokens already present in the theme.
// Dot-only (no filled chips), per AGENTS.md.
export function statusMeta(status: string): { label: string; dotClass: string } {
  switch (status) {
    case "open":        return { label: "open",        dotClass: "bg-amber-500" }
    case "in_progress": return { label: "in progress", dotClass: "bg-blue-500" }
    case "resolved":    return { label: "resolved",    dotClass: "bg-emerald-500" }
    case "closed":      return { label: "closed",      dotClass: "bg-muted-foreground" }
    default:            return { label: status || "unknown", dotClass: "bg-muted-foreground" }
  }
}

export function extractAttachment(msg?: string): { text: string; url: string | null } {
  if (!msg) return { text: "", url: null }
  const match = msg.match(/📎 Attachment: (https?:\/\/\S+)/)
  if (!match) return { text: msg, url: null }
  return { text: msg.replace(/📎 Attachment: (https?:\/\/\S+)/g, "").trim(), url: match[1] }
}

export function isImageUrl(url: string): boolean {
  return /\.(jpg|jpeg|png|gif|webp|bmp|svg)/i.test(url)
}
