"use client"

import { Paperclip, ShieldCheck, User } from "lucide-react"
import type { Reply, TicketAttachment } from "./types"
import { extractAttachment, formatFileSize, timeAgo } from "./helpers"

/** Render attachment chips for a list of attachments */
export function AttachmentChips({ attachments }: { attachments: TicketAttachment[] }) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {attachments.map((att, i) => {
        const isImage = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(att.url)
        return (
          <div key={i} className="flex flex-col gap-1">
            {isImage && (
              <a href={att.url} target="_blank" rel="noopener noreferrer">
                <img
                  src={att.url}
                  alt={att.filename}
                  className="rounded-lg max-h-32 object-cover border"
                />
              </a>
            )}
            <a
              href={att.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs bg-muted/60 hover:bg-muted border rounded-full px-2.5 py-1 transition-colors"
            >
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[140px]">{att.filename}</span>
              <span className="text-muted-foreground">({formatFileSize(att.size)})</span>
            </a>
          </div>
        )
      })}
    </div>
  )
}

interface ChatBubbleProps {
  reply: Reply
}

export function ChatBubble({ reply }: ChatBubbleProps) {
  const isAdmin = reply.is_admin
  const { text, url: legacyUrl, isImage: legacyIsImage } = extractAttachment(reply.message)
  const structuredAttachments = reply.attachments || []

  return (
    <div className={`flex ${isAdmin ? "justify-start" : "justify-end"} mb-3`}>
      <div className={`flex gap-2 max-w-[85%] ${isAdmin ? "flex-row" : "flex-row-reverse"}`}>
        {/* Avatar */}
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
        {/* Bubble */}
        <div>
          <div
            className={`px-3.5 py-2.5 text-sm leading-relaxed ${
              isAdmin
                ? "bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm"
                : "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm"
            }`}
          >
            {text && <p className="whitespace-pre-wrap">{text}</p>}
            {/* Legacy inline attachment from admin uploads */}
            {legacyUrl && (
              <div className="mt-2">
                {legacyIsImage ? (
                  <a href={legacyUrl} target="_blank" rel="noopener noreferrer">
                    <img src={legacyUrl} alt="Attachment" className="rounded-lg max-h-40 object-cover" />
                  </a>
                ) : (
                  <a
                    href={legacyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs underline"
                  >
                    <Paperclip className="h-3 w-3" />
                    View attachment
                  </a>
                )}
              </div>
            )}
            {/* Structured attachments */}
            {structuredAttachments.length > 0 && (
              <div className={`flex flex-wrap gap-1.5 mt-2 ${text ? "pt-1.5 border-t border-current/10" : ""}`}>
                {structuredAttachments.map((att, i) => {
                  const isImg = /\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?.*)?$/i.test(att.url)
                  return (
                    <div key={i} className="flex flex-col gap-1">
                      {isImg && (
                        <a href={att.url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={att.url}
                            alt={att.filename}
                            className="rounded-lg max-h-32 object-cover"
                          />
                        </a>
                      )}
                      <a
                        href={att.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={`inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 transition-colors ${
                          isAdmin
                            ? "bg-muted/60 hover:bg-muted text-foreground"
                            : "bg-primary-foreground/20 hover:bg-primary-foreground/30 text-primary-foreground"
                        }`}
                      >
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate max-w-[120px]">{att.filename}</span>
                        <span className="opacity-70">({formatFileSize(att.size)})</span>
                      </a>
                    </div>
                  )
                })}
              </div>
            )}
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
