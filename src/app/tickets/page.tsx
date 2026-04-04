"use client"

import { Suspense, useState, useCallback, useRef, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Ticket,
  Search,
  CircleDot,
  Clock,
  CheckCircle2,
  XCircle,
  Send,
  ArrowLeft,
  ChevronDown,
  Loader2,
  MessageSquare,
  AlertTriangle,
  ShieldCheck,
  User,
  Zap,
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

const STATUS_CONFIG: Record<string, { label: string; variant: string; className: string }> = {
  open: { label: "Open", variant: "warning", className: "bg-amber-50 text-amber-700 border-amber-200" },
  in_progress: { label: "In Progress", variant: "default", className: "bg-blue-50 text-blue-700 border-blue-200" },
  resolved: { label: "Resolved", variant: "success", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "Closed", variant: "secondary", className: "bg-gray-100 text-gray-500 border-gray-200" },
}

const PRIORITY_CONFIG: Record<string, { label: string; className: string; borderColor: string }> = {
  low: { label: "Low", className: "bg-gray-50 text-gray-600 border-gray-200", borderColor: "border-l-gray-300" },
  normal: { label: "Normal", className: "bg-blue-50 text-blue-600 border-blue-200", borderColor: "border-l-blue-400" },
  high: { label: "High", className: "bg-amber-50 text-amber-700 border-amber-200", borderColor: "border-l-amber-500" },
  urgent: { label: "Urgent", className: "bg-red-50 text-red-700 border-red-200", borderColor: "border-l-red-500" },
}

const FILTER_TABS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
]

const QUICK_REPLIES = [
  { label: "Acknowledging", text: "We're looking into this and will respond shortly. Thank you for your patience." },
  { label: "Need reference #", text: "Could you please provide your membership reference number so we can look into this further?" },
  { label: "Resolved", text: "This has been resolved. Please check now and let us know if you face any further issues." },
  { label: "Escalated", text: "We've escalated this to the technical team. You will be notified once the issue has been addressed." },
  { label: "Need screenshot", text: "Could you please share a screenshot of the issue you're facing? This will help us resolve it faster." },
  { label: "Payment follow-up", text: "We've checked with our payment team. Please allow up to 24 hours for the transaction to reflect. If the issue persists, kindly share your transaction ID." },
]

const ADMIN_ASSIGNEES = [
  "Unassigned",
  "AMASI Admin",
  "Technical Team",
  "Payment Team",
  "Membership Team",
]

/* ---------- types ---------- */

interface TicketReply {
  id: string
  ticket_id: string
  message: string
  is_admin: boolean
  author_name: string
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

/* ---------- sub-components ---------- */

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.open
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const cfg = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.normal
  return (
    <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full border ${cfg.className}`}>
      {cfg.label}
    </span>
  )
}

function CategoryBadge({ category }: { category: string }) {
  return (
    <Badge variant="outline" className="capitalize text-xs">
      {category}
    </Badge>
  )
}

function StatCard({ label, count, icon }: { label: string; count: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3 shadow-sm">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted/60">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-bold leading-none">{count}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  )
}

/* ---------- Ticket List Item (for inbox) ---------- */
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

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-l-4 transition-all hover:bg-muted/40 ${
        isSelected
          ? "bg-primary/5 border-l-primary"
          : priorityCfg.borderColor
      } ${unread ? "bg-blue-50/50" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {unread && (
              <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />
            )}
            <p className={`text-sm truncate ${unread ? "font-bold" : "font-semibold"}`}>
              {ticket.subject}
            </p>
          </div>
          <p className={`text-xs mt-0.5 truncate ${unread ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {ticket.name}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
            {timeAgo(ticket.created_at)}
          </span>
          <StatusBadge status={ticket.status} />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-1.5">
        <span className="font-mono text-[10px] text-muted-foreground">{ticket.ticket_number}</span>
        {ticket.priority === "urgent" && (
          <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">URGENT</span>
        )}
        {ticket.priority === "high" && (
          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">HIGH</span>
        )}
        {(ticket.status === "open" || ticket.status === "in_progress") && (
          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <Clock className="h-2.5 w-2.5" />
            {waitingTime(ticket.created_at)}
          </span>
        )}
      </div>
    </button>
  )
}

/* ---------- Chat Bubble (admin view) ---------- */
function AdminChatBubble({ reply }: { reply: TicketReply }) {
  const isAdmin = reply.is_admin
  return (
    <div className={`flex ${isAdmin ? "justify-end" : "justify-start"} mb-3`}>
      <div className={`flex gap-2 max-w-[80%] ${isAdmin ? "flex-row-reverse" : "flex-row"}`}>
        <div
          className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 ${
            isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
          }`}
        >
          {isAdmin ? <ShieldCheck className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
        </div>
        <div>
          <div
            className={`px-3.5 py-2.5 text-sm leading-relaxed ${
              isAdmin
                ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm"
                : "bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm"
            }`}
          >
            <p className="whitespace-pre-wrap">{reply.message}</p>
          </div>
          <div className={`flex items-center gap-1.5 mt-1 px-1 ${isAdmin ? "justify-end" : ""}`}>
            <span className="text-[10px] text-muted-foreground font-medium">{reply.author_name}</span>
            <span className="text-[10px] text-muted-foreground">{timeAgo(reply.created_at)}</span>
          </div>
        </div>
      </div>
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
      const haystack = `${t.ticket_number} ${t.name} ${t.email} ${t.subject}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })

  // Sort: urgent/high first, then unread, then by date
  const sortedTickets = [...filteredTickets].sort((a, b) => {
    const priorityOrder: Record<string, number> = { urgent: 0, high: 1, normal: 2, low: 3 }
    const pA = priorityOrder[a.priority] ?? 2
    const pB = priorityOrder[b.priority] ?? 2
    if (pA !== pB) return pA - pB
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
  const { data: ticketDetail, isLoading: detailLoading } = useQuery<SupportTicket>({
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
  const openTicket = useCallback(
    (ticket: SupportTicket) => {
      setSelectedTicketId(ticket.id)
      setEditStatus(ticket.status)
      setEditPriority(ticket.priority)
      setEditAssignee(ticket.assigned_to || "Unassigned")
      setReplyText("")
      setShowQuickReplies(false)
    },
    []
  )

  /* ---- update ticket mutation ---- */
  const updateMutation = useMutation({
    mutationFn: async ({ status, priority }: { status: string; priority: string }) => {
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
      queryClient.invalidateQueries({ queryKey: ["ticket-detail", selectedTicketId] })
    },
    onError: () => toast.error("Failed to update ticket"),
  })

  /* ---- reply mutation ---- */
  const replyMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await fetch(`/api/tickets/${selectedTicketId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, is_admin: true, author_name: "AMASI Admin" }),
      })
      if (!res.ok) throw new Error("Reply failed")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Reply sent")
      setReplyText("")
      setShowQuickReplies(false)
      queryClient.invalidateQueries({ queryKey: ["ticket-detail", selectedTicketId] })
      queryClient.invalidateQueries({ queryKey: ["tickets-all"] })
    },
    onError: () => toast.error("Failed to send reply"),
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(searchQuery)
  }

  const handleSaveChanges = () => {
    updateMutation.mutate({ status: editStatus, priority: editPriority })
  }

  const handleSendReply = () => {
    if (!replyText.trim()) return
    replyMutation.mutate(replyText.trim())
  }

  const handleToggleClose = () => {
    const newStatus = ticketDetail?.status === "closed" ? "open" : "closed"
    updateMutation.mutate({ status: newStatus, priority: editPriority })
    setEditStatus(newStatus)
  }

  /* ===================== SPLIT INBOX VIEW ===================== */
  if (selectedTicketId) {
    return (
      <div className="space-y-4">
        {/* Back + Stats */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 -ml-2 text-muted-foreground hover:text-foreground"
            onClick={() => setSelectedTicketId(null)}
          >
            <ArrowLeft className="h-4 w-4" /> All Tickets
          </Button>
          <div className="text-xs text-muted-foreground">
            {stats.open} open, {stats.in_progress} in progress
          </div>
        </div>

        {/* Split layout: ticket list (1/3) + conversation (2/3) */}
        <div className="flex gap-0 rounded-xl border overflow-hidden shadow-sm bg-card" style={{ height: "calc(100vh - 180px)" }}>
          {/* Left panel: ticket inbox */}
          <div className="w-1/3 border-r flex flex-col min-w-[280px]">
            {/* Search in inbox */}
            <div className="p-3 border-b bg-muted/20">
              <form onSubmit={handleSearch}>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search tickets..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value)
                      if (!e.target.value) setSearchTerm("")
                    }}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
              </form>
              {/* Mini filter tabs */}
              <div className="flex gap-1 mt-2 overflow-x-auto">
                {FILTER_TABS.map((tab) => (
                  <button
                    key={tab.value}
                    onClick={() => setStatusFilter(tab.value)}
                    className={`px-2.5 py-1 rounded-full text-[10px] font-medium border whitespace-nowrap transition-colors ${
                      statusFilter === tab.value
                        ? "bg-gray-800 text-white border-gray-800"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {tab.label}
                    {tab.value === "open" && stats.open > 0 && (
                      <span className="ml-1 bg-amber-500 text-white text-[9px] px-1 py-0.5 rounded-full">{stats.open}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Scrollable ticket list */}
            <div className="flex-1 overflow-y-auto">
              {isLoading && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {!isLoading && sortedTickets.length === 0 && (
                <div className="text-center py-12 px-4">
                  <p className="text-xs text-muted-foreground">No tickets match filters</p>
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
          </div>

          {/* Right panel: conversation + actions */}
          <div className="flex-1 flex flex-col min-w-0">
            {detailLoading || !ticketDetail ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {/* Ticket header */}
                <div className="px-5 py-3 border-b bg-muted/20 shrink-0">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="text-base font-bold truncate">{ticketDetail.subject}</h3>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="font-mono text-[10px] text-muted-foreground">{ticketDetail.ticket_number}</span>
                        <span className="text-muted-foreground text-[10px]">by</span>
                        <span className="text-xs font-medium">{ticketDetail.name}</span>
                        <span className="text-[10px] text-muted-foreground">{ticketDetail.email}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Time waiting */}
                      {(ticketDetail.status === "open" || ticketDetail.status === "in_progress") && (
                        <div className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded-full border border-amber-200">
                          <Clock className="h-3 w-3" />
                          Waiting {waitingTime(ticketDetail.created_at)}
                        </div>
                      )}
                      <StatusBadge status={ticketDetail.status} />
                      <PriorityBadge priority={ticketDetail.priority} />
                    </div>
                  </div>
                </div>

                {/* Action bar: compact inline controls */}
                <div className="px-5 py-2 border-b bg-muted/10 flex items-center gap-3 flex-wrap shrink-0">
                  {/* Status */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Status</label>
                    <div className="relative">
                      <select
                        value={editStatus}
                        onChange={(e) => setEditStatus(e.target.value)}
                        className="appearance-none rounded-md border border-input bg-background pl-2 pr-6 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {STATUS_OPTIONS.map((s) => (
                          <option key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  {/* Priority */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Priority</label>
                    <div className="relative">
                      <select
                        value={editPriority}
                        onChange={(e) => setEditPriority(e.target.value)}
                        className="appearance-none rounded-md border border-input bg-background pl-2 pr-6 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {PRIORITY_OPTIONS.map((p) => (
                          <option key={p} value={p}>{PRIORITY_CONFIG[p]?.label || p}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  {/* Assigned to */}
                  <div className="flex items-center gap-1.5">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Assign</label>
                    <div className="relative">
                      <select
                        value={editAssignee}
                        onChange={(e) => setEditAssignee(e.target.value)}
                        className="appearance-none rounded-md border border-input bg-background pl-2 pr-6 py-1 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {ADMIN_ASSIGNEES.map((a) => (
                          <option key={a} value={a}>{a}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      onClick={handleSaveChanges}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save"}
                    </Button>
                    <Button
                      size="sm"
                      variant={ticketDetail.status === "closed" ? "success" : "destructive"}
                      className="h-7 text-xs"
                      onClick={handleToggleClose}
                      disabled={updateMutation.isPending}
                    >
                      {ticketDetail.status === "closed" ? "Reopen" : "Close"}
                    </Button>
                  </div>
                </div>

                {/* Chat / conversation */}
                <div className="flex-1 overflow-y-auto px-5 py-4 bg-muted/5">
                  {/* Original message */}
                  <div className="flex justify-start mb-4">
                    <div className="flex gap-2 max-w-[80%]">
                      <div className="shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold mt-1">
                        {ticketDetail.name?.charAt(0)?.toUpperCase() || "?"}
                      </div>
                      <div>
                        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-xs font-semibold">{ticketDetail.name}</span>
                            <CategoryBadge category={ticketDetail.category} />
                          </div>
                          <p className="text-sm whitespace-pre-wrap leading-relaxed">{ticketDetail.description}</p>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1 px-1">
                          {formatDate(ticketDetail.created_at)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Replies */}
                  {(ticketDetail.replies || []).map((reply) => (
                    <AdminChatBubble key={reply.id} reply={reply} />
                  ))}

                  <div ref={chatEndRef} />
                </div>

                {/* Reply composer */}
                <div className="border-t bg-white px-5 py-3 shrink-0 space-y-2">
                  {/* Quick reply templates */}
                  {showQuickReplies && (
                    <div className="bg-muted/30 rounded-lg p-2 border space-y-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Quick Replies</span>
                        <button onClick={() => setShowQuickReplies(false)} className="text-muted-foreground hover:text-foreground">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-1">
                        {QUICK_REPLIES.map((qr) => (
                          <button
                            key={qr.label}
                            onClick={() => {
                              setReplyText(qr.text)
                              setShowQuickReplies(false)
                            }}
                            className="text-left text-xs px-2.5 py-2 rounded-md hover:bg-primary/5 border border-transparent hover:border-primary/20 transition-colors"
                          >
                            <span className="font-medium text-primary">{qr.label}</span>
                            <p className="text-muted-foreground mt-0.5 line-clamp-1">{qr.text}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2 items-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 shrink-0"
                      onClick={() => setShowQuickReplies(!showQuickReplies)}
                      title="Quick replies"
                    >
                      <Zap className="h-4 w-4 text-amber-500" />
                    </Button>
                    <Textarea
                      placeholder="Write your reply..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={2}
                      className="flex-1 resize-none min-h-[40px] max-h-[120px]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          handleSendReply()
                        }
                      }}
                    />
                    <Button
                      onClick={handleSendReply}
                      disabled={!replyText.trim() || replyMutation.isPending}
                      className="h-10 gap-1.5 shrink-0"
                    >
                      {replyMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Send
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Cmd+Enter to send
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  /* ===================== LIST VIEW ===================== */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Ticket className="h-7 w-7 text-primary" />
          Support Tickets
        </h2>
        <p className="text-muted-foreground mt-1">
          Manage and respond to member support requests
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total" count={stats.total} icon={<Ticket className="h-4 w-4 text-muted-foreground" />} />
        <StatCard label="Open" count={stats.open} icon={<CircleDot className="h-4 w-4 text-amber-600" />} />
        <StatCard label="In Progress" count={stats.in_progress} icon={<Clock className="h-4 w-4 text-blue-600" />} />
        <StatCard label="Resolved" count={stats.resolved} icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} />
      </div>

      {/* Filters */}
      <div className="space-y-3">
        {/* Status tabs */}
        <div className="flex gap-2 flex-wrap">
          {FILTER_TABS.map((tab) => {
            const isActive = statusFilter === tab.value
            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isActive
                    ? "bg-gray-800 text-white border-gray-800"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50"
                }`}
              >
                {tab.label}
                {tab.value === "open" && stats.open > 0 && (
                  <span className="ml-1.5 bg-amber-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{stats.open}</span>
                )}
              </button>
            )
          })}
        </div>

        {/* Search + category */}
        <div className="flex gap-3 flex-wrap">
          <form onSubmit={handleSearch} className="flex gap-2 flex-1 min-w-[280px] max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by ticket number, name, or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 shadow-sm"
              />
            </div>
            <Button type="submit" size="sm" className="h-10 px-5">
              Search
            </Button>
            {searchTerm && (
              <Button
                variant="ghost"
                size="sm"
                className="h-10"
                onClick={() => { setSearchTerm(""); setSearchQuery("") }}
              >
                Clear
              </Button>
            )}
          </form>

          <div className="relative">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="appearance-none rounded-md border border-input bg-background px-3 py-2 pr-9 text-sm h-10 shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.charAt(0).toUpperCase() + c.slice(1)}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Ticket list */}
      <div className="space-y-2">
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {!isLoading && sortedTickets.length === 0 && (
          <div className="rounded-xl border bg-card py-16 text-center shadow-sm">
            <AlertTriangle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No tickets found</p>
          </div>
        )}

        {sortedTickets.map((ticket) => {
          const priorityCfg = PRIORITY_CONFIG[ticket.priority] || PRIORITY_CONFIG.normal
          const unread = hasUnreadMemberReply(ticket)

          return (
            <button
              key={ticket.id}
              onClick={() => openTicket(ticket)}
              className={`w-full text-left rounded-xl border bg-card p-4 shadow-sm hover:shadow-md hover:border-primary/30 transition-all group border-l-4 ${
                priorityCfg.borderColor
              } ${unread ? "bg-blue-50/30 ring-1 ring-blue-200" : ""}`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {unread && (
                      <span className="h-2.5 w-2.5 rounded-full bg-blue-500 shrink-0" title="New member reply" />
                    )}
                    <span className="font-mono text-xs text-muted-foreground">
                      {ticket.ticket_number}
                    </span>
                    <span className="text-xs text-muted-foreground">&middot;</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(ticket.created_at)}
                    </span>
                    {(ticket.status === "open" || ticket.status === "in_progress") && (
                      <span className="text-xs text-amber-600 flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {waitingTime(ticket.created_at)}
                      </span>
                    )}
                  </div>
                  <p className={`text-sm group-hover:text-primary transition-colors truncate ${
                    unread ? "font-bold" : "font-semibold"
                  }`}>
                    {ticket.subject}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {ticket.name} &middot; {ticket.email}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <CategoryBadge category={ticket.category} />
                  <PriorityBadge priority={ticket.priority} />
                  <StatusBadge status={ticket.status} />
                </div>
              </div>
            </button>
          )
        })}
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
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <TicketsContent />
    </Suspense>
  )
}
