"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft, Loader2, CheckCircle, MessageSquare, Clock, User,
  ShieldCheck, Send, AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/utils"

/* ---------- types ---------- */
interface Ticket {
  id: string
  ticket_number: string
  name: string
  email: string
  phone: string | null
  amasi_number: string | null
  category: string
  subject: string
  description: string
  status: string
  priority?: string
  created_at: string
}

interface Reply {
  id: string
  ticket_id: string
  author_name: string
  message: string
  is_admin: boolean
  created_at: string
}

/* ---------- helpers ---------- */
function statusBadgeVariant(status: string) {
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

function statusLabel(status: string) {
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

function priorityBadgeVariant(priority: string | undefined) {
  switch (priority) {
    case "high":
    case "urgent":
      return "destructive" as const
    case "normal":
      return "secondary" as const
    case "low":
      return "outline" as const
    default:
      return "outline" as const
  }
}

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

/* ---------- Status Timeline ---------- */
function StatusTimeline({ ticket }: { ticket: Ticket }) {
  const steps = [
    { status: "open", label: "Ticket Created", description: "Your ticket has been received" },
    { status: "in_progress", label: "In Progress", description: "Our team is working on it" },
    { status: "resolved", label: "Resolved", description: "Issue has been resolved" },
    { status: "closed", label: "Closed", description: "Ticket is closed" },
  ]

  const statusOrder = ["open", "in_progress", "resolved", "closed"]
  const currentIdx = statusOrder.indexOf(ticket.status)

  return (
    <div className="py-3 px-1">
      <div className="flex items-center justify-between relative">
        <div className="absolute top-4 left-6 right-6 h-0.5 bg-muted" />
        <div
          className="absolute top-4 left-6 h-0.5 bg-primary transition-all duration-500"
          style={{ width: `calc(${(currentIdx / (steps.length - 1)) * 100}% - 48px)` }}
        />
        {steps.map((step, idx) => {
          const isActive = idx <= currentIdx
          const isCurrent = idx === currentIdx
          return (
            <div key={step.status} className="flex flex-col items-center z-10 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                    : isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isActive ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <p className={`text-[10px] mt-1.5 font-medium text-center ${
                isCurrent ? "text-primary" : isActive ? "text-foreground" : "text-muted-foreground"
              }`}>
                {step.label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- Chat Bubble ---------- */
function ChatBubble({ reply }: { reply: Reply }) {
  const isAdmin = reply.is_admin
  return (
    <div className={`flex ${isAdmin ? "justify-start" : "justify-end"} mb-3`}>
      <div className={`flex gap-2 max-w-[85%] ${isAdmin ? "flex-row" : "flex-row-reverse"}`}>
        <div
          className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 ${
            isAdmin
              ? "bg-blue-100 text-blue-700"
              : "bg-primary/10 text-primary"
          }`}
        >
          {isAdmin ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <User className="h-3.5 w-3.5" />
          )}
        </div>
        <div>
          <div
            className={`px-3.5 py-2.5 text-sm leading-relaxed ${
              isAdmin
                ? "bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm"
                : "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm"
            }`}
          >
            <p className="whitespace-pre-wrap">{reply.message}</p>
          </div>
          <div className={`flex items-center gap-1.5 mt-1 px-1 ${isAdmin ? "" : "justify-end"}`}>
            <span className="text-[10px] text-muted-foreground font-medium">
              {reply.author_name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {timeAgo(reply.created_at)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- main page ---------- */
export default function TicketPermalinkPage() {
  const params = useParams<{ ticketNumber: string }>()
  const ticketNumber = params.ticketNumber

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [replies, setReplies] = useState<Reply[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [replyText, setReplyText] = useState("")
  const [sendingReply, setSendingReply] = useState(false)
  const [showTyping, setShowTyping] = useState(false)

  const repliesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest reply
  useEffect(() => {
    if (repliesEndRef.current) {
      repliesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [replies, showTyping])

  // Fetch ticket data
  useEffect(() => {
    async function fetchTicket() {
      setLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/tickets/by-number/${encodeURIComponent(ticketNumber)}`)
        if (!res.ok) {
          if (res.status === 404) {
            setError("Ticket not found. Please check the ticket number and try again.")
          } else {
            setError("Failed to load ticket. Please try again later.")
          }
          return
        }

        const data = await res.json()
        setTicket(data.ticket)
        setReplies(data.replies || [])
      } catch {
        setError("Failed to load ticket. Please try again later.")
      } finally {
        setLoading(false)
      }
    }

    if (ticketNumber) {
      fetchTicket()
    }
  }, [ticketNumber])

  // Send reply
  async function handleReply() {
    if (!replyText.trim() || !ticket) return
    setSendingReply(true)

    try {
      const res = await fetch(`/api/tickets/${ticket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyText.trim(),
          author_name: ticket.name,
          is_admin: false,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to send reply")

      setReplies((prev) => [...prev, data.reply || data])
      setReplyText("")

      // Show typing indicator for UX polish
      setShowTyping(true)
      setTimeout(() => setShowTyping(false), 3000)
    } catch {
      // silently fail -- user can retry
    } finally {
      setSendingReply(false)
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Loading ticket...</p>
        </div>
      </div>
    )
  }

  // Error state
  if (error || !ticket) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-4 py-8">
          <Link
            href="/support"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Support
          </Link>

          <Card className="rounded-xl">
            <CardContent className="p-8 text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertCircle className="h-8 w-8 text-destructive" />
              </div>
              <h2 className="text-xl font-semibold">Ticket Not Found</h2>
              <p className="text-sm text-muted-foreground">
                {error || "The ticket you are looking for does not exist."}
              </p>
              <p className="text-xs text-muted-foreground">
                Ticket number: <span className="font-mono">{ticketNumber}</span>
              </p>
              <Button variant="outline" asChild>
                <Link href="/support">Go to Support Center</Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link
          href="/support"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Support
        </Link>

        {/* Ticket header */}
        <Card className="rounded-xl mb-6">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-xs font-mono text-muted-foreground">
                    {ticket.ticket_number}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {ticket.category}
                  </Badge>
                  <Badge variant={statusBadgeVariant(ticket.status)} className="text-[10px]">
                    {statusLabel(ticket.status)}
                  </Badge>
                  {ticket.priority && (
                    <Badge variant={priorityBadgeVariant(ticket.priority)} className="text-[10px]">
                      {ticket.priority.charAt(0).toUpperCase() + ticket.priority.slice(1)}
                    </Badge>
                  )}
                </div>
                <h1 className="text-lg font-semibold">{ticket.subject}</h1>
              </div>
              <MessageSquare className="h-5 w-5 text-muted-foreground shrink-0 mt-1" />
            </div>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {ticket.name}
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDate(ticket.created_at)}
              </div>
            </div>

            {/* Status timeline */}
            <div className="mt-4 border-t pt-3">
              <StatusTimeline ticket={ticket} />
            </div>
          </CardContent>
        </Card>

        {/* Conversation */}
        <Card className="rounded-xl">
          <CardContent className="p-0">
            {/* Chat area */}
            <div className="px-4 py-4 min-h-[200px] max-h-[60vh] overflow-y-auto">
              {/* Original description as first message */}
              <div className="flex justify-end mb-3">
                <div className="flex gap-2 max-w-[85%] flex-row-reverse">
                  <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 bg-primary/10 text-primary">
                    <User className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="px-3.5 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm">
                      <p className="whitespace-pre-wrap">{ticket.description}</p>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1 px-1 justify-end">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        {ticket.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(ticket.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* No replies yet */}
              {replies.length === 0 && (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1.5 inline-block">
                    Waiting for a response from our team
                  </p>
                </div>
              )}

              {/* Replies */}
              {replies.map((reply) => (
                <ChatBubble key={reply.id} reply={reply} />
              ))}

              {/* Typing indicator */}
              {showTyping && (
                <div className="flex justify-start mb-3">
                  <div className="flex gap-2 items-end">
                    <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-blue-100 text-blue-700">
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </div>
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={repliesEndRef} />
            </div>

            {/* Reply form */}
            {ticket.status !== "closed" ? (
              <div className="px-4 py-3 border-t bg-muted/20">
                <div className="flex gap-2 items-end">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your message..."
                    rows={1}
                    className="flex-1 resize-none min-h-[40px] max-h-[120px] bg-white"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleReply()
                      }
                    }}
                  />
                  <Button
                    onClick={handleReply}
                    disabled={sendingReply || !replyText.trim()}
                    size="sm"
                    className="h-10 w-10 p-0 rounded-full shrink-0"
                  >
                    {sendingReply ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Press Enter to send, Shift+Enter for new line
                </p>
              </div>
            ) : (
              <div className="px-4 py-3 border-t bg-muted/30 text-center">
                <p className="text-xs text-muted-foreground">
                  This ticket has been closed. If you need further help, please submit a new ticket.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
