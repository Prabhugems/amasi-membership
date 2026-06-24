"use client"

import { ShieldCheck, User, FileText, ExternalLink, Paperclip } from "lucide-react"
import type { TicketReply, TicketAttachment } from "../lib/types"
import { extractAttachment, formatFileSize, timeAgo } from "../lib/ticket-utils"

function AttachmentChip({ att }: { att: TicketAttachment }) {
  return (
    <a
      href={att.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-md border border-border bg-background/60 text-foreground hover:bg-accent transition-colors"
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      <span className="truncate max-w-[140px]">{att.filename}</span>
      <span className="text-muted-foreground">({formatFileSize(att.size)})</span>
    </a>
  )
}

function InlineAttachment({ url, isImage }: { url: string; isImage: boolean }) {
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img
          src={url}
          alt="Attachment"
          className="rounded-md border border-border max-h-52 object-cover cursor-pointer hover:opacity-90 transition-opacity"
        />
      </a>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 text-xs font-medium px-3 py-2 rounded-md border border-border bg-background/60 text-foreground hover:bg-accent transition-colors"
    >
      <FileText className="h-3.5 w-3.5" />
      View attachment
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

export function ChatBubble({ reply }: { reply: TicketReply }) {
  const isAdmin = reply.is_admin
  const isInternal = reply.is_internal === true
  const { text, url, isImage } = extractAttachment(reply.message)
  const structuredAttachments = reply.attachments || []

  if (isInternal) {
    return (
      <div className="flex justify-end mb-4">
        <div className="flex gap-2.5 max-w-[75%] flex-row-reverse">
          <div className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center mt-1 bg-amber-500/10 text-amber-600">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-amber-600 px-1 text-right">Internal note</div>
            <div className="px-4 py-3 text-sm leading-relaxed bg-amber-500/10 border-l-2 border-amber-500/50 text-foreground rounded-md shadow-sm">
              {text && <p className="whitespace-pre-wrap">{text}</p>}
              {url && <div className={`mt-2 ${text ? "pt-2 border-t border-border" : ""}`}><InlineAttachment url={url} isImage={isImage} /></div>}
            </div>
            <div className="flex items-center gap-1.5 px-1 justify-end">
              <span className="text-[10px] text-muted-foreground font-medium">{reply.author_name}</span>
              <span className="text-[10px] text-muted-foreground/60">{timeAgo(reply.created_at)}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isAdmin ? "justify-end" : "justify-start"} mb-4`}>
      <div className={`flex gap-2.5 max-w-[75%] ${isAdmin ? "flex-row-reverse" : "flex-row"}`}>
        <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center mt-1 ${isAdmin ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
          {isAdmin ? <ShieldCheck className="h-4 w-4" /> : <User className="h-4 w-4" />}
        </div>
        <div className="space-y-1">
          <div className={`px-4 py-3 text-sm leading-relaxed rounded-md border shadow-sm ${isAdmin ? "bg-primary/10 border-border text-foreground" : "bg-card border-border text-foreground"}`}>
            {text && <p className="whitespace-pre-wrap">{text}</p>}
            {url && <div className={`mt-2 ${text ? "pt-2 border-t border-border" : ""}`}><InlineAttachment url={url} isImage={isImage} /></div>}
            {structuredAttachments.length > 0 && (
              <div className={`flex flex-wrap gap-1.5 mt-2 ${text || url ? "pt-2 border-t border-border" : ""}`}>
                {structuredAttachments.map((att, i) => (
                  <AttachmentChip key={i} att={att} />
                ))}
              </div>
            )}
          </div>
          <div className={`flex items-center gap-1.5 px-1 ${isAdmin ? "justify-end" : ""}`}>
            <span className="text-[10px] text-muted-foreground font-medium">{reply.author_name}</span>
            <span className="text-[10px] text-muted-foreground/60">{timeAgo(reply.created_at)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
