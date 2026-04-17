"use client"

import {
  ShieldCheck,
  User,
  FileText,
  ExternalLink,
  Paperclip,
} from "lucide-react"
import type { TicketReply, TicketAttachment } from "../lib/types"
import { extractAttachment, formatFileSize, timeAgo } from "../lib/ticket-utils"

/* ---------- Attachment chip sub-component ---------- */

function AttachmentChip({
  att,
  isAdmin,
}: {
  att: TicketAttachment
  isAdmin: boolean
}) {
  return (
    <a
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
  )
}

/* ---------- ChatBubble ---------- */

export function ChatBubble({ reply }: { reply: TicketReply }) {
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
                  <AttachmentChip key={i} att={att} isAdmin={isAdmin} />
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
