"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import {
  Search, Send, Loader2, MessageSquare, Clock, User, ShieldCheck,
  Paperclip, X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/utils"
import type { Ticket, Reply, TicketAttachment } from "./types"
import { MAX_ATTACHMENTS, MAX_FILE_SIZE, ALLOWED_FILE_TYPES, DESCRIPTION_MAX } from "./types"
import {
  statusBadgeVariant, statusLabel, timeAgo, formatFileSize, uploadTicketFile,
} from "./helpers"
import { StatusTimeline } from "./StatusTimeline"
import { ChatBubble } from "./ChatBubble"

/* Skeleton card for loading state */
function TicketSkeleton() {
  return (
    <Card className="rounded-xl">
      <CardContent className="p-4">
        <div className="animate-pulse space-y-2">
          <div className="flex gap-2">
            <div className="h-4 w-20 bg-muted rounded" />
            <div className="h-4 w-16 bg-muted rounded-full" />
            <div className="h-4 w-14 bg-muted rounded-full" />
          </div>
          <div className="h-5 w-3/4 bg-muted rounded" />
          <div className="h-3 w-1/3 bg-muted rounded" />
        </div>
      </CardContent>
    </Card>
  )
}

export function TicketTracker() {
  // track state
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [searchDone, setSearchDone] = useState(false)

  // OTP verification state
  const [otpPhase, setOtpPhase] = useState<"none" | "sending" | "verifying">("none")
  const [otpDigits, setOtpDigits] = useState("")
  const [otpError, setOtpError] = useState<string | null>(null)
  const [otpCooldown, setOtpCooldown] = useState(0)
  const [isVerified, setIsVerified] = useState(false)

  // dialog state
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [replies, setReplies] = useState<Reply[]>([])
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [replyText, setReplyText] = useState("")
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replyAttachments, setReplyAttachments] = useState<File[]>([])
  const [sendingReply, setSendingReply] = useState(false)
  const replyFileInputRef = useRef<HTMLInputElement>(null)

  const repliesEndRef = useRef<HTMLDivElement>(null)
  const repliesContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest reply
  useEffect(() => {
    if (repliesEndRef.current) {
      repliesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [replies])

  /* --- handle file attachment for reply --- */
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

  // OTP cooldown timer
  useEffect(() => {
    if (otpCooldown <= 0) return
    const t = setTimeout(() => setOtpCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [otpCooldown])

  /* --- search tickets --- */
  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchDone(false)

    try {
      const isPhone = /^\d{10,}$/.test(searchQuery.trim().replace(/\s/g, ""))
      const param = isPhone
        ? `phone=${encodeURIComponent(searchQuery.trim())}`
        : `email=${encodeURIComponent(searchQuery.trim())}`

      const res = await fetch(`/api/tickets?${param}`)
      const data = await res.json()
      const found = Array.isArray(data) ? data : []
      setTickets(found)

      // If tickets found and not yet verified, start OTP flow
      if (found.length > 0 && !isVerified) {
        const emailForOtp = isPhone ? (found[0]?.email || "") : searchQuery.trim()
        if (emailForOtp) {
          setOtpPhase("sending")
          setOtpError(null)
          try {
            const otpRes = await fetch("/api/otp/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ email: emailForOtp }),
            })
            const otpData = await otpRes.json()
            if (otpData.status) {
              setOtpPhase("verifying")
              setOtpCooldown(60)
            } else {
              setOtpPhase("none")
              setOtpError(otpData.message || "Failed to send verification code.")
            }
          } catch {
            setOtpPhase("none")
            setOtpError("Failed to send verification code.")
          }
        }
      }
    } catch {
      setTickets([])
    } finally {
      setSearching(false)
      setSearchDone(true)
    }
  }

  async function handleVerifyOtp() {
    if (otpDigits.length !== 6) return
    setOtpError(null)
    const emailForOtp = tickets[0]?.email || searchQuery.trim()
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailForOtp, code: otpDigits }),
      })
      const data = await res.json()
      if (data.status) {
        setIsVerified(true)
        setOtpPhase("none")
        setOtpDigits("")
      } else {
        setOtpError(data.message || "Invalid code.")
        setOtpDigits("")
      }
    } catch {
      setOtpError("Verification failed.")
    }
  }

  async function handleResendOtp() {
    if (otpCooldown > 0) return
    const emailForOtp = tickets[0]?.email || searchQuery.trim()
    setOtpError(null)
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailForOtp }),
      })
      const data = await res.json()
      if (data.status) setOtpCooldown(60)
      else setOtpError(data.message || "Failed to resend code.")
    } catch {
      setOtpError("Failed to resend code.")
    }
  }

  async function openTicket(ticket: Ticket) {
    setSelectedTicket(ticket)
    setReplies([])
    setReplyText("")
    setReplyError(null)
    setLoadingReplies(true)

    try {
      const res = await fetch(`/api/tickets/${ticket.id}`)
      if (res.status === 401) {
        setReplyError("Session expired. Please search again to re-verify.")
        setIsVerified(false)
        setSelectedTicket(null)
        return
      }
      const data = await res.json()
      const allReplies: Reply[] = data.replies || []
      setReplies(allReplies.filter((r) => !r.is_internal))
    } catch {
      setReplies([])
    } finally {
      setLoadingReplies(false)
    }
  }

  /* --- send reply --- */
  async function handleReply() {
    if (!replyText.trim() && replyAttachments.length === 0) return
    if (!selectedTicket) return
    setSendingReply(true)
    setReplyError(null)

    try {
      let uploadedAttachments: TicketAttachment[] = []
      if (replyAttachments.length > 0) {
        const uploads = await Promise.all(
          replyAttachments.map((file) =>
            uploadTicketFile(
              file,
              `tickets/${selectedTicket.id}/replies/${Date.now()}_${file.name}`
            )
          )
        )
        uploadedAttachments = uploads.filter((a): a is TicketAttachment => a !== null)
      }

      const res = await fetch(`/api/tickets/${selectedTicket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyText.trim(),
          author_name: selectedTicket.name,
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

  // Check if ticket has admin reply (for badge indicator)
  function hasAdminReply(ticket: Ticket): boolean {
    // We only know from loaded replies context; for the card list we show the indicator
    // based on status change (in_progress or resolved means admin has engaged)
    return ticket.status === "in_progress" || ticket.status === "resolved"
  }

  return (
    <div className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold flex items-center justify-center gap-2">
          <Search className="h-5 w-5 text-primary" />
          Track My Tickets
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your email or phone number to find your tickets
        </p>
      </div>

      <Card className="rounded-xl">
        <CardContent className="p-4">
          <Label htmlFor="ticket-search" className="text-xs text-muted-foreground mb-1.5 block">
            Enter the email or phone you used when creating your ticket
          </Label>
          <div className="flex gap-2">
            <Input
              id="ticket-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Email or phone number"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              className="flex-1"
            />
            <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
              {searching ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Search className="h-4 w-4 mr-1.5" />
                  Search
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {searching && (
        <div className="space-y-3">
          <TicketSkeleton />
          <TicketSkeleton />
          <TicketSkeleton />
        </div>
      )}

      {/* Empty state */}
      {searchDone && !searching && tickets.length === 0 && (
        <div className="text-center py-8 space-y-3">
          <p className="text-muted-foreground text-sm">
            No tickets found for this email or phone number.
          </p>
          <p className="text-sm">
            Need help?{" "}
            <a
              href="#ticket-form"
              className="text-primary hover:underline font-medium"
              onClick={(e) => {
                e.preventDefault()
                document.getElementById("ticket-form")?.scrollIntoView({ behavior: "smooth" })
              }}
            >
              Create a new ticket
            </a>
          </p>
        </div>
      )}

      {/* OTP verification prompt — shown after search finds tickets but before verification */}
      {tickets.length > 0 && !isVerified && otpPhase === "verifying" && (
        <Card className="rounded-xl border-primary/30 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="text-center space-y-1">
              <p className="text-sm font-medium">Verify your identity</p>
              <p className="text-xs text-muted-foreground">
                We sent a 6-digit code to your email. Enter it below to view your tickets.
              </p>
            </div>
            {otpError && (
              <p className="text-xs text-red-500 text-center">{otpError}</p>
            )}
            <div className="flex gap-2 max-w-xs mx-auto">
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={otpDigits}
                onChange={(e) => setOtpDigits(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => { if (e.key === "Enter") handleVerifyOtp() }}
                className="text-center font-mono text-lg tracking-[0.3em]"
              />
              <Button onClick={handleVerifyOtp} disabled={otpDigits.length !== 6}>
                Verify
              </Button>
            </div>
            <div className="text-center">
              <button
                type="button"
                onClick={handleResendOtp}
                disabled={otpCooldown > 0}
                className="text-xs text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
              >
                {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend code"}
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Ticket list — only clickable after OTP verification */}
      {tickets.length > 0 && (isVerified || otpPhase === "none") && (
        <div className="space-y-3">
          {tickets.map((ticket) => (
            <Card
              key={ticket.id}
              className={`rounded-xl transition-all ${isVerified ? "cursor-pointer hover:border-primary/40 hover:shadow-md" : "opacity-60"}`}
              onClick={() => isVerified && openTicket(ticket)}
              tabIndex={0}
              role="button"
              aria-label={`View ticket ${ticket.ticket_number}: ${ticket.subject}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  openTicket(ticket)
                }
              }}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        href={`/support/${ticket.ticket_number}`}
                        className="text-xs font-mono text-muted-foreground hover:text-primary hover:underline transition-colors"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        {ticket.ticket_number}
                      </Link>
                      <Badge variant="outline" className="text-[10px]">
                        {ticket.category}
                      </Badge>
                      <Badge variant={statusBadgeVariant(ticket.status)} className="text-[10px]">
                        {statusLabel(ticket.status)}
                      </Badge>
                      {hasAdminReply(ticket) && (
                        <Badge variant="secondary" className="text-[10px] bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200">
                          Admin replied
                        </Badge>
                      )}
                    </div>
                    <Link
                      href={`/support/${ticket.ticket_number}`}
                      className="font-medium mt-1 truncate block hover:text-primary transition-colors"
                      onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                      {ticket.subject}
                    </Link>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {formatDate(ticket.created_at)}
                    </div>
                  </div>
                  <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ======== Ticket Detail Dialog ======== */}
      <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
        <DialogContent
          className="max-w-lg w-full max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden"
          aria-describedby={undefined}
        >
          {/* Dialog Header */}
          <div className="px-5 pt-5 pb-3 border-b bg-muted/30">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-base pr-6">
                <MessageSquare className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{selectedTicket?.subject}</span>
              </DialogTitle>
              {selectedTicket && (
                <div className="flex items-center gap-2 flex-wrap pt-1">
                  <span className="text-xs font-mono text-muted-foreground">
                    {selectedTicket.ticket_number}
                  </span>
                  <Badge variant="outline" className="text-[10px]">
                    {selectedTicket.category}
                  </Badge>
                  <Badge variant={statusBadgeVariant(selectedTicket.status)} className="text-[10px]">
                    {statusLabel(selectedTicket.status)}
                  </Badge>
                </div>
              )}
            </DialogHeader>

            {/* Status timeline */}
            {selectedTicket && (
              <StatusTimeline ticket={selectedTicket} replies={replies} />
            )}
          </div>

          {/* Chat area */}
          <div
            ref={repliesContainerRef}
            className="flex-1 overflow-y-auto min-h-0 px-4 py-4"
            style={{ maxHeight: "50vh" }}
            role="log"
            aria-live="polite"
            aria-label="Conversation"
          >
            {/* Original description as first message */}
            {selectedTicket && (
              <div className="flex justify-end mb-3">
                <div className="flex gap-2 max-w-[85%] flex-row-reverse">
                  <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 bg-primary/10 text-primary">
                    <User className="h-3.5 w-3.5" />
                  </div>
                  <div>
                    <div className="px-3.5 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm">
                      <p className="whitespace-pre-wrap">{selectedTicket.description}</p>
                      {selectedTicket.attachments && selectedTicket.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2 pt-1.5 border-t border-primary-foreground/20">
                          {selectedTicket.attachments.map((att, i) => (
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
                        {selectedTicket.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {timeAgo(selectedTicket.created_at)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Loading */}
            {loadingReplies && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* No replies */}
            {!loadingReplies && replies.length === 0 && (
              <div className="text-center py-4">
                <p className="text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1.5 inline-block">
                  Waiting for a response from our team
                </p>
              </div>
            )}

            {!loadingReplies && replies.map((reply) => (
              <ChatBubble key={reply.id} reply={reply} />
            ))}

            <div ref={repliesEndRef} />
          </div>

          {/* Reply form - hide for closed AND resolved */}
          {selectedTicket && selectedTicket.status !== "closed" && selectedTicket.status !== "resolved" && (
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
          )}

          {selectedTicket && (selectedTicket.status === "closed" || selectedTicket.status === "resolved") && (
            <div className="px-4 py-3 border-t bg-muted/30 text-center">
              <p className="text-xs text-muted-foreground">
                This ticket has been {statusLabel(selectedTicket.status).toLowerCase()}. If you need further help, please create a new ticket.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
