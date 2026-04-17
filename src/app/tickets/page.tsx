"use client"

import { Suspense, useState, useCallback, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Ticket,
  Search,
  Clock,
  XCircle,
  Send,
  ChevronDown,
  Loader2,
  MessageSquare,
  AlertTriangle,
  ShieldCheck,
  User,
  Zap,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
  ExternalLink,
  RotateCcw,
  Save,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"

/* ---------- constants ---------- */

const CATEGORIES = [
  "Application Issue",
  "Profile Update",
  "Payment Issue",
  "Certificate/Card",
  "Technical Issue",
  "Other",
] as const

const STATUS_OPTIONS = ["open", "in_progress", "resolved", "closed"] as const

const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: string; className: string; dotColor: string; tabBg: string; tabText: string }
> = {
  open: {
    label: "Open",
    variant: "warning",
    className: "bg-amber-50 text-amber-700 border-amber-200 soft-pulse",
    dotColor: "bg-amber-500",
    tabBg: "bg-amber-50 border-amber-200 hover:bg-amber-100",
    tabText: "text-amber-700",
  },
  in_progress: {
    label: "In Progress",
    variant: "default",
    className: "bg-blue-50 text-blue-700 border-blue-200 soft-pulse",
    dotColor: "bg-blue-500",
    tabBg: "bg-blue-50 border-blue-200 hover:bg-blue-100",
    tabText: "text-blue-700",
  },
  resolved: {
    label: "Resolved",
    variant: "success",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotColor: "bg-emerald-500",
    tabBg: "bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
    tabText: "text-emerald-700",
  },
  closed: {
    label: "Closed",
    variant: "secondary",
    className: "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700",
    dotColor: "bg-gray-400",
    tabBg: "bg-gray-50 dark:bg-slate-800/60 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800",
    tabText: "text-gray-500 dark:text-slate-400",
  },
}

const PRIORITY_CONFIG: Record<
  string,
  { label: string; className: string; borderColor: string; dotColor: string }
> = {
  low: {
    label: "Low",
    className: "bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700",
    borderColor: "border-l-gray-300",
    dotColor: "bg-gray-400",
  },
  normal: {
    label: "Normal",
    className: "bg-blue-50 text-blue-600 border-blue-200",
    borderColor: "border-l-blue-400",
    dotColor: "bg-blue-400",
  },
  high: {
    label: "High",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    borderColor: "border-l-amber-500",
    dotColor: "bg-amber-500",
  },
  urgent: {
    label: "Urgent",
    className: "bg-red-50 text-red-700 border-red-200",
    borderColor: "border-l-red-500",
    dotColor: "bg-red-500",
  },
}

const FILTER_TABS = [
  { value: "", label: "All", color: "bg-gray-800 text-white border-gray-800" },
  { value: "open", label: "Open", color: "bg-amber-600 text-white border-amber-600" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-600 text-white border-blue-600" },
  { value: "resolved", label: "Resolved", color: "bg-emerald-600 text-white border-emerald-600" },
  { value: "closed", label: "Closed", color: "bg-gray-500 text-white border-gray-500" },
]

const QUICK_REPLIES = [
  {
    label: "Acknowledging",
    text: "We're looking into this and will respond shortly. Thank you for your patience.",
  },
  {
    label: "Need reference #",
    text: "Could you please provide your membership reference number so we can look into this further?",
  },
  {
    label: "Resolved",
    text: "This has been resolved. Please check now and let us know if you face any further issues.",
  },
  {
    label: "Escalated",
    text: "We've escalated this to the technical team. You will be notified once the issue has been addressed.",
  },
  {
    label: "Need screenshot",
    text: "Could you please share a screenshot of the issue you're facing? This will help us resolve it faster.",
  },
  {
    label: "Payment follow-up",
    text: "We've checked with our payment team. Please allow up to 24 hours for the transaction to reflect. If the issue persists, kindly share your transaction ID.",
  },
]

const ADMIN_ASSIGNEES = [
  "Unassigned",
  "AMASI Admin",
  "Technical Team",
  "Payment Team",
  "Membership Team",
]

/* ---------- types ---------- */

interface TicketAttachment {
  url: string
  filename: string
  size: number
}

interface TicketReply {
  id: string
  ticket_id: string
  message: string
  is_admin: boolean
  is_internal?: boolean
  author_name: string
  attachments?: TicketAttachment[]
  created_at: string
}

interface SupportTicket {
  id: string
  ticket_number: string
  name: string
  email: string
  subject: string
  description: string
  category: string
  status: string
  priority: string
  assigned_to?: string
  attachments?: TicketAttachment[]
  created_at: string
  updated_at: string
  replies?: TicketReply[]
}

/* ---------- helpers ---------- */

function timeAgo(dateStr: string) {
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

function waitingTime(dateStr: string) {
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

/** Check if the last reply on a ticket is from the member (not admin) */
function hasUnreadMemberReply(ticket: SupportTicket): boolean {
  if (!ticket.replies || ticket.replies.length === 0) return false
  const lastReply = ticket.replies[ticket.replies.length - 1]
  return !lastReply.is_admin
}

/** Get the last message preview text */
function lastMessagePreview(ticket: SupportTicket): string {
  if (ticket.replies && ticket.replies.length > 0) {
    const last = ticket.replies[ticket.replies.length - 1]
    const prefix = last.is_admin ? "You: " : ""
    return prefix + last.message.replace(/\n/g, " ")
  }
  return ticket.description.replace(/\n/g, " ")
}

/** Extract attachment URL from message if present */
function extractAttachment(message: string): { text: string; url: string | null; isImage: boolean } {
  const attachmentMatch = message.match(/📎 Attachment: (https?:\/\/\S+)/)
  if (attachmentMatch) {
    const url = attachmentMatch[1]
    const text = message.replace(/\n?\n?📎 Attachment: https?:\/\/\S+/, "").trim()
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(url)
    return { text, url, isImage }
  }
  return { text: message, url: null, isImage: false }
}

/** Format file size */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + " B"
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB"
  return (bytes / (1024 * 1024)).toFixed(1) + " MB"
}

/* ---------- sub-components ---------- */

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dotColor} mr-1.5`} />
      {cfg.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal
  return (
    <span
      className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.className}`}
    >
      {cfg.label}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="outline" className="capitalize text-[10px]">
      {category}
    </Badge>
  )
}

/* ---------- Ticket List Item (for left panel) ---------- */
function TicketListItem({
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
              <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0 animate-pulse" />
            )}
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
            <span className="font-mono text-[10px] text-muted-foreground/60">
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
          <span className="text-[9px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
            Urgent
          </span>
        )}
        {ticket.priority === "high" && (
          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded uppercase tracking-wider">
            High
          </span>
        )}
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

/* ---------- Chat Bubble ---------- */
function ChatBubble({ reply }: { reply: TicketReply }) {
  const isAdmin = reply.is_admin
  const isInternal = reply.is_internal === true
  const { text, url, isImage } = extractAttachment(reply.message)
  const structuredAttachments = reply.attachments || []

  // Internal notes get a distinct amber style
  if (isInternal) {
    return (
      <div className="flex justify-end mb-4">
        <div className="flex gap-2.5 max-w-[75%] flex-row-reverse">
          {/* Avatar */}
          <div className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 shadow-sm bg-amber-100 text-amber-700">
            <ShieldCheck className="h-4 w-4" />
          </div>
          {/* Bubble */}
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 px-1 text-right">
              Internal note
            </div>
            <div className="px-4 py-3 text-sm leading-relaxed bg-amber-50 dark:bg-amber-500/10 border-l-2 border-amber-400 text-amber-900 dark:text-amber-200 rounded-2xl rounded-tr-md shadow-sm">
              {text && <p className="whitespace-pre-wrap">{text}</p>}
              {url && (
                <div className={`mt-2 ${text ? "pt-2 border-t border-amber-200 dark:border-amber-500/20" : ""}`}>
                  {isImage ? (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                      <img
                        src={url}
                        alt="Attachment"
                        className="rounded-lg max-h-52 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                      />
                    </a>
                  ) : (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg transition-colors bg-amber-100 dark:bg-amber-500/20 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-500/30"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      View attachment
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-1.5 px-1 justify-end">
              <span className="text-[10px] text-amber-600/70 dark:text-amber-400/70 font-medium">
                {reply.author_name}
              </span>
              <span className="text-[10px] text-amber-600/50 dark:text-amber-400/50">
                {timeAgo(reply.created_at)}
              </span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isAdmin ? "justify-end" : "justify-start"} mb-4`}>
      <div
        className={`flex gap-2.5 max-w-[75%] ${isAdmin ? "flex-row-reverse" : "flex-row"}`}
      >
        {/* Avatar */}
        <div
          className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 shadow-sm ${
            isAdmin
              ? "bg-teal-100 text-teal-700"
              : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
          }`}
        >
          {isAdmin ? (
            <ShieldCheck className="h-4 w-4" />
          ) : (
            <User className="h-4 w-4" />
          )}
        </div>
        {/* Bubble */}
        <div className="space-y-1">
          <div
            className={`px-4 py-3 text-sm leading-relaxed ${
              isAdmin
                ? "bg-teal-600 text-white rounded-2xl rounded-tr-md shadow-md"
                : "bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 text-gray-800 dark:text-slate-200 rounded-2xl rounded-tl-md shadow-sm"
            }`}
          >
            {text && <p className="whitespace-pre-wrap">{text}</p>}
            {/* Inline attachment */}
            {url && (
              <div className={`mt-2 ${text ? "pt-2 border-t" : ""} ${isAdmin ? "border-teal-500/30" : "border-gray-100 dark:border-slate-800"}`}>
                {isImage ? (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                    <img
                      src={url}
                      alt="Attachment"
                      className="rounded-lg max-h-52 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                    />
                  </a>
                ) : (
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-lg transition-colors ${
                      isAdmin
                        ? "bg-teal-500/30 text-teal-50 hover:bg-teal-500/40"
                        : "bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    View attachment
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}
            {/* Structured attachments (member uploads) */}
            {structuredAttachments.length > 0 && (
              <div className={`flex flex-wrap gap-1.5 mt-2 ${text || url ? "pt-2 border-t" : ""} ${isAdmin ? "border-teal-500/30" : "border-gray-100 dark:border-slate-800"}`}>
                {structuredAttachments.map((att, i) => (
                  <a
                    key={i}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors ${
                      isAdmin
                        ? "bg-teal-500/30 text-teal-50 hover:bg-teal-500/40"
                        : "bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700"
                    }`}
                  >
                    <Paperclip className="h-3 w-3 shrink-0" />
                    <span className="truncate max-w-[120px]">{att.filename}</span>
                    <span className="opacity-70">({formatFileSize(att.size)})</span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <div
            className={`flex items-center gap-1.5 px-1 ${isAdmin ? "justify-end" : ""}`}
          >
            <span className="text-[10px] text-muted-foreground font-medium">
              {reply.author_name}
            </span>
            <span className="text-[10px] text-muted-foreground/60">
              {timeAgo(reply.created_at)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- Empty conversation panel ---------- */
function EmptyConversation() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-8">
      <div className="h-16 w-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-4">
        <MessageSquare className="h-8 w-8 text-muted-foreground/40" />
      </div>
      <h3 className="text-lg font-semibold text-muted-foreground/70">
        Select a ticket
      </h3>
      <p className="text-sm text-muted-foreground/50 mt-1 max-w-xs">
        Choose a ticket from the left panel to view the conversation and manage it
      </p>
    </div>
  )
}

/* ---------- Stat pill (compact) ---------- */
function StatPill({
  label,
  count,
  active,
  color,
}: {
  label: string
  count: number
  active?: boolean
  color: string
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        active ? color : "bg-muted/40 text-muted-foreground"
      }`}
    >
      <span className="font-bold">{count}</span>
      <span>{label}</span>
    </div>
  )
}

/* ---------- main component ---------- */

function TicketsContent() {
  const queryClient = useQueryClient()

  // filters
  const [statusFilter, setStatusFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")

  // detail view
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [replyText, setReplyText] = useState("")
  const [showQuickReplies, setShowQuickReplies] = useState(false)

  // internal note toggle
  const [isInternalNote, setIsInternalNote] = useState(false)

  // attachment
  const [attachedFile, setAttachedFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // edits on detail
  const [editStatus, setEditStatus] = useState("")
  const [editPriority, setEditPriority] = useState("")
  const [editAssignee, setEditAssignee] = useState("Unassigned")

  const chatEndRef = useRef<HTMLDivElement>(null)

  /* ---- fetch all tickets ---- */
  const { data: allTickets = [], isLoading } = useQuery<SupportTicket[]>({
    queryKey: ["tickets-all"],
    queryFn: async () => {
      const res = await fetch("/api/tickets?all=1")
      if (!res.ok) throw new Error("Failed to fetch tickets")
      const json = await res.json()
      return Array.isArray(json) ? json : []
    },
  })

  /* ---- filtered tickets ---- */
  const filteredTickets = allTickets.filter((t) => {
    if (statusFilter && t.status !== statusFilter) return false
    if (categoryFilter && t.category !== categoryFilter) return false
    if (searchTerm) {
      const q = searchTerm.toLowerCase()
      const haystack =
        `${t.ticket_number} ${t.name} ${t.email} ${t.subject}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  // Sort: urgent/high first, then unread, then by date
  const sortedTickets = [...filteredTickets].sort((a, b) => {
    const priorityOrder: Record<string, number> = {
      urgent: 0,
      high: 1,
      normal: 2,
      low: 3,
    }
    const pA = priorityOrder[a.priority] ?? 2
    const pB = priorityOrder[b.priority] ?? 2
    if (pA !== pB) return pA - pB
    // Unread first within same priority
    const uA = hasUnreadMemberReply(a) ? 0 : 1
    const uB = hasUnreadMemberReply(b) ? 0 : 1
    if (uA !== uB) return uA - uB
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  /* ---- stats ---- */
  const stats = {
    total: allTickets.length,
    open: allTickets.filter((t) => t.status === "open").length,
    in_progress: allTickets.filter((t) => t.status === "in_progress").length,
    resolved: allTickets.filter((t) => t.status === "resolved").length,
  }

  /* ---- fetch single ticket detail ---- */
  const { data: ticketDetail, isLoading: detailLoading } =
    useQuery<SupportTicket>({
      queryKey: ["ticket-detail", selectedTicketId],
      queryFn: async () => {
        const res = await fetch(`/api/tickets/${selectedTicketId}`)
        if (!res.ok) throw new Error("Failed to fetch ticket")
        const json = await res.json()
        return { ...json.ticket, replies: json.replies || [] }
      },
      enabled: !!selectedTicketId,
    })

  // auto-scroll when replies load
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [ticketDetail?.replies?.length])

  /* ---- when ticket detail loads, seed edit fields ---- */
  const openTicket = useCallback((ticket: SupportTicket) => {
    setSelectedTicketId(ticket.id)
    setEditStatus(ticket.status)
    setEditPriority(ticket.priority)
    setEditAssignee(ticket.assigned_to || "Unassigned")
    setReplyText("")
    setShowQuickReplies(false)
    setAttachedFile(null)
    setIsInternalNote(false)
  }, [])

  /* ---- update ticket mutation ---- */
  const updateMutation = useMutation({
    mutationFn: async ({
      status,
      priority,
    }: {
      status: string
      priority: string
    }) => {
      const res = await fetch(`/api/tickets/${selectedTicketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, priority }),
      })
      if (!res.ok) throw new Error("Update failed")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Ticket updated")
      queryClient.invalidateQueries({ queryKey: ["tickets-all"] })
      queryClient.invalidateQueries({
        queryKey: ["ticket-detail", selectedTicketId],
      })
    },
    onError: () => toast.error("Failed to update ticket"),
  })

  /* ---- reply mutation (supports FormData for attachments) ---- */
  const replyMutation = useMutation({
    mutationFn: async ({
      message,
      file,
      internal,
    }: {
      message: string
      file: File | null
      internal: boolean
    }) => {
      if (file) {
        const fd = new FormData()
        fd.append("message", message)
        fd.append("author_name", "AMASI Admin")
        fd.append("attachment", file)
        if (internal) fd.append("is_internal", "true")
        const res = await fetch(`/api/tickets/${selectedTicketId}/reply`, {
          method: "POST",
          body: fd,
        })
        if (!res.ok) throw new Error("Reply failed")
        return res.json()
      }
      const res = await fetch(`/api/tickets/${selectedTicketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          is_admin: true,
          is_internal: internal,
          author_name: "AMASI Admin",
        }),
      })
      if (!res.ok) throw new Error("Reply failed")
      return res.json()
    },
    onSuccess: () => {
      toast.success(isInternalNote ? "Internal note added" : "Reply sent")
      setReplyText("")
      setShowQuickReplies(false)
      setAttachedFile(null)
      setIsInternalNote(false)
      queryClient.invalidateQueries({
        queryKey: ["ticket-detail", selectedTicketId],
      })
      queryClient.invalidateQueries({ queryKey: ["tickets-all"] })
    },
    onError: () => toast.error(isInternalNote ? "Failed to add note" : "Failed to send reply"),
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(searchQuery)
  }

  const handleSaveChanges = () => {
    updateMutation.mutate({ status: editStatus, priority: editPriority })
  }

  const handleSendReply = () => {
    if (!replyText.trim() && !attachedFile) return
    replyMutation.mutate({ message: replyText.trim(), file: attachedFile, internal: isInternalNote })
  }

  const handleToggleClose = () => {
    const newStatus = ticketDetail?.status === "closed" ? "open" : "closed"
    updateMutation.mutate({ status: newStatus, priority: editPriority })
    setEditStatus(newStatus)
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File too large. Max 10MB.")
        return
      }
      setAttachedFile(file)
    }
  }

  /* ===================== ALWAYS SPLIT INBOX ===================== */
  return (
    <div className="space-y-0">
      {/* Top bar: title + stats */}
      <div className="flex items-center justify-between px-1 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-teal-600 flex items-center justify-center shadow-sm">
              <Ticket className="h-5 w-5 text-white" />
            </div>
            Support Tickets
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5 ml-[46px]">
            Manage and respond to member support requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatPill
            label="Open"
            count={stats.open}
            active={stats.open > 0}
            color="bg-amber-100 text-amber-800"
          />
          <StatPill
            label="In Progress"
            count={stats.in_progress}
            active={stats.in_progress > 0}
            color="bg-blue-100 text-blue-800"
          />
          <StatPill
            label="Resolved"
            count={stats.resolved}
            active={stats.resolved > 0}
            color="bg-emerald-100 text-emerald-800"
          />
          <div className="h-5 w-px bg-border mx-1" />
          <span className="text-xs text-muted-foreground font-medium">
            {stats.total} total
          </span>
        </div>
      </div>

      {/* Split layout container */}
      <div
        className="flex rounded-xl border overflow-hidden shadow-sm bg-card"
        style={{ height: "calc(100vh - 160px)" }}
      >
        {/* ============ LEFT PANEL: Ticket List ============ */}
        <div className="w-[380px] min-w-[320px] border-r flex flex-col bg-white dark:bg-slate-900">
          {/* Search */}
          <div className="p-3 border-b">
            <form onSubmit={handleSearch}>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
                <Input
                  placeholder="Search by name, email, ticket #..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value)
                    if (!e.target.value) setSearchTerm("")
                  }}
                  className="pl-9 h-9 text-xs bg-gray-50/80 dark:bg-slate-800/60 border-gray-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 transition-colors"
                />
              </div>
            </form>

            {/* Status filter tabs */}
            <div className="flex gap-1.5 mt-2.5 overflow-x-auto pb-0.5">
              {FILTER_TABS.map((tab) => {
                const isActive = statusFilter === tab.value
                const count =
                  tab.value === ""
                    ? stats.total
                    : stats[tab.value as keyof typeof stats] ?? 0
                return (
                  <button
                    key={tab.value}
                    onClick={() => setStatusFilter(tab.value)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap transition-all duration-150 ${
                      isActive
                        ? tab.color
                        : "bg-white dark:bg-slate-900 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/60 hover:text-gray-700 dark:hover:text-slate-300"
                    }`}
                  >
                    {tab.label}
                    {count > 0 && (
                      <span
                        className={`ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                          isActive
                            ? "bg-white/25 text-inherit"
                            : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Category filter */}
            <div className="mt-2">
              <div className="relative">
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full appearance-none rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50/80 dark:bg-slate-800/60 px-2.5 py-1.5 pr-7 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">All Categories</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
              </div>
            </div>
          </div>

          {/* Scrollable ticket list */}
          <div className="flex-1 overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && sortedTickets.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                <AlertTriangle className="h-6 w-6 text-muted-foreground/30 mb-2" />
                <p className="text-xs text-muted-foreground">
                  No tickets match your filters
                </p>
              </div>
            )}
            {sortedTickets.map((ticket) => (
              <TicketListItem
                key={ticket.id}
                ticket={ticket}
                isSelected={ticket.id === selectedTicketId}
                onClick={() => openTicket(ticket)}
              />
            ))}
          </div>

          {/* Bottom count */}
          <div className="px-4 py-2 border-t bg-gray-50/50 dark:bg-slate-800/40 text-[10px] text-muted-foreground/60 font-medium">
            {sortedTickets.length} ticket{sortedTickets.length !== 1 ? "s" : ""}
            {statusFilter && ` (${STATUS_CONFIG[statusFilter]?.label || statusFilter})`}
          </div>
        </div>

        {/* ============ RIGHT PANEL: Conversation ============ */}
        <div className="flex-1 flex flex-col min-w-0 bg-gray-50/30 dark:bg-slate-800/30">
          {!selectedTicketId ? (
            <EmptyConversation />
          ) : detailLoading || !ticketDetail ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
                <span className="text-xs text-muted-foreground">
                  Loading conversation...
                </span>
              </div>
            </div>
          ) : (
            <>
              {/* Ticket header */}
              <div className="px-6 py-3.5 border-b bg-white dark:bg-slate-900 shrink-0">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold truncate leading-tight">
                      {ticketDetail.subject}
                    </h3>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded">
                        {ticketDetail.ticket_number}
                      </span>
                      <span className="text-xs font-medium text-foreground/80">
                        {ticketDetail.name}
                      </span>
                      <span className="text-[11px] text-muted-foreground/60">
                        {ticketDetail.email}
                      </span>
                      <CategoryBadge category={ticketDetail.category} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(ticketDetail.status === "open" ||
                      ticketDetail.status === "in_progress") && (
                      <div className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-1 rounded-full border border-amber-200 font-medium">
                        <Clock className="h-3 w-3" />
                        {waitingTime(ticketDetail.created_at)}
                      </div>
                    )}
                    <StatusBadge status={ticketDetail.status} />
                    <PriorityBadge priority={ticketDetail.priority} />
                  </div>
                </div>
              </div>

              {/* Admin action bar */}
              <div className="px-6 py-2.5 border-b bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm flex items-center gap-4 flex-wrap shrink-0">
                {/* Status dropdown */}
                <div className="flex items-center gap-1.5">
                  <label className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                    Status
                  </label>
                  <div className="relative">
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="appearance-none rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2.5 pr-7 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 focus-visible:border-teal-400 transition-shadow"
                    >
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_CONFIG[s]?.label || s}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
                  </div>
                </div>

                {/* Priority dropdown */}
                <div className="flex items-center gap-1.5">
                  <label className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                    Priority
                  </label>
                  <div className="relative">
                    <select
                      value={editPriority}
                      onChange={(e) => setEditPriority(e.target.value)}
                      className="appearance-none rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2.5 pr-7 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 focus-visible:border-teal-400 transition-shadow"
                    >
                      {PRIORITY_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_CONFIG[p]?.label || p}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
                  </div>
                </div>

                {/* Assignee dropdown */}
                <div className="flex items-center gap-1.5">
                  <label className="text-[9px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                    Assign
                  </label>
                  <div className="relative">
                    <select
                      value={editAssignee}
                      onChange={(e) => setEditAssignee(e.target.value)}
                      className="appearance-none rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-2.5 pr-7 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 focus-visible:border-teal-400 transition-shadow"
                    >
                      {ADMIN_ASSIGNEES.map((a) => (
                        <option key={a} value={a}>
                          {a}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
                  </div>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-2 ml-auto">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs gap-1.5 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/60"
                    onClick={handleSaveChanges}
                    disabled={updateMutation.isPending}
                  >
                    {updateMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Save className="h-3 w-3" />
                    )}
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant={
                      ticketDetail.status === "closed"
                        ? "outline"
                        : "destructive"
                    }
                    className={`h-7 text-xs gap-1.5 ${
                      ticketDetail.status === "closed"
                        ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                        : ""
                    }`}
                    onClick={handleToggleClose}
                    disabled={updateMutation.isPending}
                  >
                    {ticketDetail.status === "closed" ? (
                      <>
                        <RotateCcw className="h-3 w-3" /> Reopen
                      </>
                    ) : (
                      <>
                        <XCircle className="h-3 w-3" /> Close
                      </>
                    )}
                  </Button>
                </div>
              </div>

              {/* Chat / conversation */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* Original message */}
                <div className="flex justify-start mb-5">
                  <div className="flex gap-2.5 max-w-[75%]">
                    <div className="shrink-0 h-9 w-9 rounded-full bg-gray-200 flex items-center justify-center text-sm font-bold mt-1 shadow-sm text-gray-600 dark:text-slate-400">
                      {ticketDetail.name?.charAt(0)?.toUpperCase() || "?"}
                    </div>
                    <div>
                      <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-2xl rounded-tl-md px-4 py-3.5 shadow-sm">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-bold text-foreground">
                            {ticketDetail.name}
                          </span>
                          <CategoryBadge category={ticketDetail.category} />
                          <span className="text-[10px] text-muted-foreground/50">
                            opened this ticket
                          </span>
                        </div>
                        <p className="text-sm whitespace-pre-wrap leading-relaxed text-gray-700 dark:text-slate-300">
                          {ticketDetail.description}
                        </p>
                        {/* Ticket-level attachments */}
                        {ticketDetail.attachments && ticketDetail.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5 pt-2 border-t border-gray-100 dark:border-slate-800">
                            {ticketDetail.attachments.map((att, i) => (
                              <a
                                key={i}
                                href={att.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 hover:bg-gray-100 dark:hover:bg-slate-800 border border-gray-200 dark:border-slate-700"
                              >
                                <Paperclip className="h-3 w-3 shrink-0" />
                                <span className="truncate max-w-[120px]">{att.filename}</span>
                                <span className="opacity-70">({formatFileSize(att.size)})</span>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground/60 mt-1.5 px-1">
                        {formatDate(ticketDetail.created_at)}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Replies */}
                {(ticketDetail.replies || []).map((reply) => (
                  <ChatBubble key={reply.id} reply={reply} />
                ))}

                <div ref={chatEndRef} />
              </div>

              {/* Reply composer */}
              <div className="border-t bg-white dark:bg-slate-900 px-6 py-3.5 shrink-0 space-y-2.5">
                {/* Quick reply templates */}
                {showQuickReplies && (
                  <div className="bg-gray-50 dark:bg-slate-800/60 rounded-xl p-3 border border-gray-200 dark:border-slate-700 shadow-sm">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                        <Zap className="h-3 w-3 text-amber-500" />
                        Quick Replies
                      </span>
                      <button
                        onClick={() => setShowQuickReplies(false)}
                        aria-label="Hide quick replies"
                        className="text-muted-foreground/50 hover:text-foreground transition-colors"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {QUICK_REPLIES.map((qr) => (
                        <button
                          key={qr.label}
                          onClick={() => {
                            setReplyText(qr.text)
                            setShowQuickReplies(false)
                          }}
                          className="text-left text-xs px-3 py-2.5 rounded-lg hover:bg-teal-50 border border-transparent hover:border-teal-200 transition-all duration-150 group"
                        >
                          <span className="font-semibold text-teal-700 group-hover:text-teal-800">
                            {qr.label}
                          </span>
                          <p className="text-muted-foreground/60 mt-0.5 line-clamp-1 text-[11px]">
                            {qr.text}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* File preview */}
                {attachedFile && (
                  <div className="flex items-center gap-3 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                    <div className="h-8 w-8 rounded-lg bg-teal-100 flex items-center justify-center shrink-0">
                      {attachedFile.type.startsWith("image/") ? (
                        <ImageIcon className="h-4 w-4 text-teal-600" />
                      ) : (
                        <FileText className="h-4 w-4 text-teal-600" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-teal-800 truncate">
                        {attachedFile.name}
                      </p>
                      <p className="text-[10px] text-teal-600/70">
                        {formatFileSize(attachedFile.size)}
                      </p>
                    </div>
                    <button
                      onClick={() => setAttachedFile(null)}
                      aria-label="Remove attachment"
                      className="text-teal-500 hover:text-teal-700 transition-colors shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Internal note banner */}
                {isInternalNote && (
                  <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-lg px-3 py-2">
                    <span className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-widest">
                      Internal note
                    </span>
                    <span className="text-[11px] text-amber-600/70 dark:text-amber-400/70">
                      Only visible to admins. The member will not be notified.
                    </span>
                  </div>
                )}

                {/* Reply input row */}
                <div className="flex gap-2 items-end">
                  {/* Quick replies button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0 shrink-0 hover:bg-amber-50"
                    onClick={() => setShowQuickReplies(!showQuickReplies)}
                    title="Quick replies"
                  >
                    <Zap className="h-4 w-4 text-amber-500" />
                  </Button>

                  {/* Attachment button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-10 w-10 p-0 shrink-0 hover:bg-gray-100 dark:hover:bg-slate-800"
                    onClick={() => fileInputRef.current?.click()}
                    title="Attach file"
                  >
                    <Paperclip className="h-4 w-4 text-muted-foreground" />
                  </Button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf,.doc,.docx,.txt"
                    className="hidden"
                    onChange={handleFileSelect}
                  />

                  {/* Internal note toggle */}
                  <button
                    type="button"
                    onClick={() => setIsInternalNote(!isInternalNote)}
                    title={isInternalNote ? "Switch to public reply" : "Switch to internal note"}
                    className={`shrink-0 h-10 px-3 rounded-lg text-xs font-semibold border transition-all duration-150 ${
                      isInternalNote
                        ? "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-500/30 hover:bg-amber-200 dark:hover:bg-amber-500/30"
                        : "bg-white dark:bg-slate-900 text-muted-foreground border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/60 hover:text-foreground"
                    }`}
                  >
                    Internal note
                  </button>

                  {/* Textarea */}
                  <Textarea
                    placeholder={isInternalNote ? "Write an internal note..." : "Write your reply..."}
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={2}
                    className={`flex-1 resize-none min-h-[42px] max-h-[120px] transition-colors ${
                      isInternalNote
                        ? "bg-amber-50/50 dark:bg-amber-500/5 border-amber-200 dark:border-amber-500/20 focus:bg-amber-50 dark:focus:bg-amber-500/10"
                        : "bg-gray-50/80 dark:bg-slate-800/60 border-gray-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900"
                    }`}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        (e.metaKey || e.ctrlKey)
                      ) {
                        e.preventDefault()
                        handleSendReply()
                      }
                    }}
                  />

                  {/* Send button */}
                  <Button
                    onClick={handleSendReply}
                    disabled={
                      (!replyText.trim() && !attachedFile) ||
                      replyMutation.isPending
                    }
                    className={`h-10 gap-1.5 shrink-0 shadow-sm ${
                      isInternalNote
                        ? "bg-amber-500 hover:bg-amber-600 text-white"
                        : "bg-teal-600 hover:bg-teal-700"
                    }`}
                  >
                    {replyMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    {isInternalNote ? "Add note" : "Send"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground/50 pl-[88px]">
                  Cmd+Enter to send
                  {attachedFile ? " | 1 file attached" : ""}
                  {isInternalNote ? " | Internal note mode" : ""}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- page export with Suspense ---------- */

export default function TicketsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
        </div>
      }
    >
      <TicketsContent />
    </Suspense>
  )
}
