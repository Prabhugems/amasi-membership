"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  ArrowLeft, Loader2, MessageSquare, Clock, User,
  ShieldCheck, Send, AlertCircle, Paperclip, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { formatDate } from "@/lib/utils"
import type { Ticket, Reply, TicketAttachment } from "../components/types"
import { DESCRIPTION_MAX, MAX_ATTACHMENTS, MAX_FILE_SIZE, ALLOWED_FILE_TYPES } from "../components/types"
import {
  statusBadgeVariant, statusLabel, timeAgo, formatFileSize, uploadTicketFile,
} from "../components/helpers"
import { StatusTimeline } from "../components/StatusTimeline"
import { ChatBubble } from "../components/ChatBubble"

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

/* ---------- main page ---------- */
export default function TicketPermalinkPage() {
  const params = useParams<{ ticketNumber: string }>()
  const ticketNumber = params.ticketNumber

  const [ticket, setTicket] = useState<Ticket | null>(null)
  const [replies, setReplies] = useState<Reply[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Email verification gate
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)
  const [emailInput, setEmailInput] = useState("")
  const [verifying, setVerifying] = useState(false)

  const [replyText, setReplyText] = useState("")
  const [replyError, setReplyError] = useState<string | null>(null)
  const [sendingReply, setSendingReply] = useState(false)

  // Reply attachments
  const [replyAttachments, setReplyAttachments] = useState<File[]>([])
  const replyFileInputRef = useRef<HTMLInputElement>(null)

  const repliesEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest reply
  useEffect(() => {
    if (repliesEndRef.current) {
      repliesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [replies])

  // TODO(auth): This page uses email-based ticket lookup which now requires
  // a member session. Must route through permalink verification flow (OTP)
  // instead of raw email param. Tracked for next session.
  useEffect(() => {
    if (!verifiedEmail || !ticketNumber) return
    async function fetchTicket() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `/api/tickets/by-number/${encodeURIComponent(ticketNumber)}?email=${encodeURIComponent(verifiedEmail!)}`
        )
        if (!res.ok) {
          if (res.status === 404) {
            setError("Ticket not found. The email may not match the ticket owner.")
            setVerifiedEmail(null)
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
    fetchTicket()
  }, [ticketNumber, verifiedEmail])

  async function handleVerifyEmail() {
    if (!emailInput.trim()) return
    setVerifying(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/tickets/by-number/${encodeURIComponent(ticketNumber)}?email=${encodeURIComponent(emailInput.trim())}`
      )
      if (res.ok) {
        setVerifiedEmail(emailInput.trim())
      } else {
        setError("No ticket found with this email. Please check and try again.")
      }
    } catch {
      setError("Verification failed. Please try again.")
    } finally {
      setVerifying(false)
    }
  }

  /* --- handle reply file attachment --- */
  function handleReplyFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    const newFiles: File[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      if (replyAttachments.length + newFiles.length >= MAX_ATTACHMENTS) break
      if (file.size > MAX_FILE_SIZE) continue
      if (!ALLOWED_FILE_TYPES.includes(file.type)) continue
      newFiles.push(file)
    }
    if (newFiles.length > 0) {
      setReplyAttachments((prev) => [...prev, ...newFiles].slice(0, MAX_ATTACHMENTS))
    }
    e.target.value = ""
  }

  // Send reply
  async function handleReply() {
    if (!replyText.trim() && replyAttachments.length === 0) return
    if (!ticket) return
    setSendingReply(true)
    setReplyError(null)

    try {
      // Upload reply attachments first
      let uploadedAttachments: TicketAttachment[] = []
      if (replyAttachments.length > 0) {
        const uploads = await Promise.all(
          replyAttachments.map((file) =>
            uploadTicketFile(
              file,
              `tickets/${ticket.id}/replies/${Date.now()}_${file.name}`
            )
          )
        )
        uploadedAttachments = uploads.filter((a): a is TicketAttachment => a !== null)
      }

      const res = await fetch(`/api/tickets/${ticket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyText.trim(),
          author_name: ticket.name,
          as_member: true,
          attachments: uploadedAttachments,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to send reply")

      setReplies((prev) => [...prev, data.reply || data])
      setReplyText("")
      setReplyAttachments([])
    } catch (err) {
      setReplyError(err instanceof Error ? err.message : "Failed to send reply. Please try again.")
    } finally {
      setSendingReply(false)
    }
  }

  // Email verification gate
  if (!verifiedEmail && !loading && !ticket) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-md mx-auto px-4 py-16">
          <Link
            href="/support"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Support
          </Link>
          <Card className="rounded-xl">
            <CardContent className="p-8 space-y-4">
              <div className="text-center space-y-2">
                <div className="inline-block bg-muted/60 border rounded-xl px-4 py-2 mb-2">
                  <span className="text-lg font-mono font-bold tracking-wider">{ticketNumber}</span>
                </div>
                <h2 className="text-lg font-semibold">Verify your identity</h2>
                <p className="text-sm text-muted-foreground">
                  We use this to verify you are the ticket owner. Enter the email you used when creating this ticket.
                </p>
              </div>
              {error && (
                <p className="text-xs text-red-500 text-center" role="alert">{error}</p>
              )}
              <div>
                <Label htmlFor="verify-email" className="text-xs mb-1 block">
                  Email address
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="verify-email"
                    type="email"
                    placeholder="your@email.com"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleVerifyEmail() }}
                    className="flex-1"
                  />
                  <Button onClick={handleVerifyEmail} disabled={verifying || !emailInput.trim()}>
                    {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
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
            <div
              className="px-4 py-4 min-h-[200px] max-h-[60vh] overflow-y-auto"
              role="log"
              aria-live="polite"
              aria-label="Conversation"
            >
              {/* Original description as first message */}
              <div className="flex justify-end mb-3">
                <div className="flex gap-2 max-w-[85%] flex-row-reverse">
                  <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 bg-primary/10 text-primary">
                    <User className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="px-3.5 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm">
                      <p className="whitespace-pre-wrap">{ticket.description}</p>
                      {/* Ticket-level attachments */}
                      {ticket.attachments && ticket.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2 pt-1.5 border-t border-primary-foreground/20">
                          {ticket.attachments.map((att, i) => (
                            <a
                              key={i}
                              href={att.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground rounded-full px-2.5 py-1 transition-colors"
                            >
                              <Paperclip className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[120px]">{att.filename}</span>
                              <span className="opacity-70">({formatFileSize(att.size)})</span>
                            </a>
                          ))}
                        </div>
                      )}
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

              <div ref={repliesEndRef} />
            </div>

            {/* Reply form - hide for closed AND resolved */}
            {ticket.status !== "closed" && ticket.status !== "resolved" ? (
              <div className="px-4 py-3 border-t bg-muted/20">
                {replyError && (
                  <p className="text-xs text-red-500 mb-2" role="alert">{replyError}</p>
                )}
                {/* Reply attachment previews */}
                {replyAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {replyAttachments.map((file, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-1.5 bg-muted/60 border rounded-full px-2.5 py-1 text-xs"
                      >
                        <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate max-w-[100px]">{file.name}</span>
                        <span className="text-muted-foreground">({formatFileSize(file.size)})</span>
                        <button
                          type="button"
                          onClick={() => setReplyAttachments((prev) => prev.filter((_, j) => j !== i))}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 items-end">
                  {/* Attach file button */}
                  {replyAttachments.length < MAX_ATTACHMENTS && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-10 w-10 p-0 shrink-0 hover:bg-muted"
                      onClick={() => replyFileInputRef.current?.click()}
                      title="Attach file"
                    >
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                  <input
                    ref={replyFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="hidden"
                    onChange={handleReplyFileChange}
                  />
                  <div className="flex-1">
                    <Textarea
                      value={replyText}
                      onChange={(e) => {
                        if (e.target.value.length <= DESCRIPTION_MAX) {
                          setReplyText(e.target.value)
                        }
                      }}
                      placeholder="Type your message..."
                      rows={1}
                      className="resize-none min-h-[40px] max-h-[120px] bg-white"
                      aria-label="Reply message"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault()
                          handleReply()
                        }
                      }}
                    />
                  </div>
                  <Button
                    onClick={handleReply}
                    disabled={sendingReply || (!replyText.trim() && replyAttachments.length === 0)}
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
                <div className="flex items-center justify-between mt-1.5">
                  <p className="text-[10px] text-muted-foreground">
                    Press Enter to send, Shift+Enter for new line
                    {replyAttachments.length > 0 && ` | ${replyAttachments.length} file${replyAttachments.length > 1 ? "s" : ""} attached`}
                  </p>
                  <span className={`text-[10px] tabular-nums ${
                    replyText.length > DESCRIPTION_MAX * 0.9
                      ? "text-amber-600"
                      : "text-muted-foreground"
                  }`}>
                    {replyText.length} / {DESCRIPTION_MAX}
                  </span>
                </div>
              </div>
            ) : (
              <div className="px-4 py-3 border-t bg-muted/30 text-center">
                <p className="text-xs text-muted-foreground">
                  This ticket has been {statusLabel(ticket.status).toLowerCase()}. If you need further help, please{" "}
                  <Link href="/support" className="text-primary hover:underline">create a new ticket</Link>.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
