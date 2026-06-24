// src/components/member-support/TicketConversation.tsx
"use client"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Send, Loader2, Paperclip, X, FileText, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { statusMeta, extractAttachment, isImageUrl } from "./support-constants"
import { replyToTicket } from "./support-api"
import type { MemberTicket, TicketReply } from "./types"

export default function TicketConversation({
  ticket, replies, repliesLoading, memberName, onBack, onReplyAdded, onReopened,
}: {
  ticket: MemberTicket
  replies: TicketReply[]
  repliesLoading: boolean
  memberName: string
  onBack: () => void
  onReplyAdded: (r: TicketReply) => void
  onReopened: () => void
}) {
  const [text, setText] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [sending, setSending] = useState(false)
  const [reopening, setReopening] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const sm = statusMeta(ticket.status)
  const isClosed = ticket.status === "closed" || ticket.status === "resolved"

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [replies])

  const send = async () => {
    if (!text.trim() && !file) return
    setSending(true)
    try {
      const r = await replyToTicket(ticket.id, { message: text.trim(), authorName: memberName, file })
      if (r && (r.id || r.message)) { onReplyAdded(r); setText(""); setFile(null) }
      else toast.error("Couldn't send your reply. Please try again.")
    } catch { toast.error("Couldn't send your reply. Please try again.") }
    finally { setSending(false) }
  }

  // Reopen: replicate the exact request used in member/page.tsx (see Step 1).
  const reopen = async () => {
    setReopening(true)
    try {
      const res = await fetch(`/api/tickets/${ticket.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "open" }),
      })
      if (res.ok) { toast.success("Ticket reopened"); onReopened() }
      else toast.error("Failed to reopen")
    } catch { toast.error("Failed to reopen") }
    finally { setReopening(false) }
  }

  return (
    <div className="max-w-2xl flex flex-col" style={{ minHeight: "calc(100vh - 220px)" }}>
      {/* Header */}
      <div className="flex items-start justify-between border-b border-border pb-4">
        <div className="min-w-0">
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 mb-1 gap-1.5 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back
          </Button>
          <h2 className="truncate text-xl font-bold tracking-tight">{ticket.subject}</h2>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={`h-2 w-2 rounded-full ${sm.dotClass}`} /> {sm.label}
            {ticket.ticket_number ? ` · ${ticket.ticket_number}` : ""}
          </p>
        </div>
      </div>

      {/* Thread */}
      <div className="flex-1 space-y-3 overflow-y-auto py-5">
        {repliesLoading ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          replies.map((r, i) => {
            const mine = r.as_member || r.author_role === "member"
            const { text: body, url } = extractAttachment(r.message)
            return (
              <div key={r.id || i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-md border px-3.5 py-2.5 text-sm ${mine ? "border-border bg-accent" : "border-border bg-card"}`}>
                  <p className="mb-1 text-[11px] font-medium text-muted-foreground">{mine ? "You" : (r.author_name || "AMASI Support")}</p>
                  {body && <p className="whitespace-pre-wrap leading-relaxed">{body}</p>}
                  {url && (isImageUrl(url)
                    ? <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt="attachment" className="mt-2 max-h-48 rounded-md border border-border" /></a>
                    : <a href={url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"><FileText className="h-3.5 w-3.5" /> View attachment</a>)}
                </div>
              </div>
            )
          })
        )}
        <div ref={endRef} />
      </div>

      {/* Composer / reopen */}
      {isClosed ? (
        <div className="rounded-md border border-border bg-muted/50 p-4 text-center">
          <p className="text-sm text-muted-foreground">This ticket is {sm.label}.</p>
          <Button variant="outline" size="sm" onClick={reopen} disabled={reopening} className="mt-2 gap-2">
            {reopening ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Reopen ticket
          </Button>
        </div>
      ) : (
        <div className="border-t border-border pt-3">
          {file && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <button onClick={() => setFile(null)} aria-label="Remove" className="text-muted-foreground hover:text-destructive"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileInput} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            <Button variant="outline" size="icon" onClick={() => fileInput.current?.click()} aria-label="Attach file" className="shrink-0"><Paperclip className="h-4 w-4" /></Button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send() }}
              placeholder="Write a reply…"
              rows={2}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60"
            />
            <Button onClick={send} disabled={sending || (!text.trim() && !file)} size="icon" className="shrink-0">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
