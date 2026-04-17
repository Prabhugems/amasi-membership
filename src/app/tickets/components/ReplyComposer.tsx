"use client"

import { RefObject } from "react"
import {
  Send,
  Loader2,
  Zap,
  Paperclip,
  X,
  FileText,
  Image as ImageIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { formatFileSize } from "../lib/ticket-utils"
import { ReplyTemplatesDialog } from "./ReplyTemplatesDialog"
import type { useTicketDetail } from "../hooks/useTicketDetail"

type DetailHook = ReturnType<typeof useTicketDetail>

export function ReplyComposer({
  replyText,
  setReplyText,
  showQuickReplies,
  setShowQuickReplies,
  isInternalNote,
  setIsInternalNote,
  attachedFile,
  setAttachedFile,
  fileInputRef,
  quickReplies,
  replyMutation,
  handleSendReply,
  handleFileSelect,
  handleQuickReplySelect,
  queryClient,
}: {
  replyText: DetailHook["replyText"]
  setReplyText: DetailHook["setReplyText"]
  showQuickReplies: DetailHook["showQuickReplies"]
  setShowQuickReplies: DetailHook["setShowQuickReplies"]
  isInternalNote: DetailHook["isInternalNote"]
  setIsInternalNote: DetailHook["setIsInternalNote"]
  attachedFile: DetailHook["attachedFile"]
  setAttachedFile: DetailHook["setAttachedFile"]
  fileInputRef: RefObject<HTMLInputElement | null>
  quickReplies: DetailHook["quickReplies"]
  replyMutation: DetailHook["replyMutation"]
  handleSendReply: DetailHook["handleSendReply"]
  handleFileSelect: DetailHook["handleFileSelect"]
  handleQuickReplySelect: DetailHook["handleQuickReplySelect"]
  queryClient: DetailHook["queryClient"]
}) {
  return (
    <div className="border-t bg-white dark:bg-slate-900 px-6 py-3.5 shrink-0 space-y-2.5">
      {/* Quick reply templates */}
      {showQuickReplies && (
        <div className="bg-gray-50 dark:bg-slate-800/60 rounded-xl p-3 border border-gray-200 dark:border-slate-700 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-amber-500" />
              Quick Replies
            </span>
            <div className="flex items-center gap-2">
              <ReplyTemplatesDialog onTemplatesChanged={() => queryClient.invalidateQueries({ queryKey: ["reply-templates"] })} />
              <button
                onClick={() => setShowQuickReplies(false)}
                aria-label="Hide quick replies"
                className="text-muted-foreground/50 hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {quickReplies.map((qr) => (
              <button
                key={qr.label}
                onClick={() => handleQuickReplySelect(qr.text)}
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
          aria-label="Reply message"
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
  )
}
