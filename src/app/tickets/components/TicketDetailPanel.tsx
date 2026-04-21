"use client"

import { RefObject } from "react"
import {
  Clock,
  XCircle,
  ChevronDown,
  Loader2,
  MessageSquare,
  Paperclip,
  RotateCcw,
  Save,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { STATUS_OPTIONS, STATUS_CONFIG, PRIORITY_OPTIONS, PRIORITY_CONFIG, ADMIN_ASSIGNEES } from "../lib/constants"
import type { SupportTicket } from "../lib/types"
import { waitingTime, formatDuration, formatFileSize } from "../lib/ticket-utils"
import { StatusBadge, PriorityBadge, CategoryBadge, SlaBadge } from "./TicketBadges"
import { ChatBubble } from "./ChatBubble"
import { ReplyComposer } from "./ReplyComposer"
import type { useTicketDetail } from "../hooks/useTicketDetail"

type DetailHook = ReturnType<typeof useTicketDetail>

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

export function TicketDetailPanel({
  selectedTicketId,
  ticketDetail,
  detailLoading,
  editStatus,
  setEditStatus,
  editPriority,
  setEditPriority,
  editAssignee,
  setEditAssignee,
  updateMutation,
  handleSaveChanges,
  handleToggleClose,
  chatEndRef,
  // Reply composer props
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
  selectedTicketId: DetailHook["selectedTicketId"]
  ticketDetail: DetailHook["ticketDetail"]
  detailLoading: DetailHook["detailLoading"]
  editStatus: DetailHook["editStatus"]
  setEditStatus: DetailHook["setEditStatus"]
  editPriority: DetailHook["editPriority"]
  setEditPriority: DetailHook["setEditPriority"]
  editAssignee: DetailHook["editAssignee"]
  setEditAssignee: DetailHook["setEditAssignee"]
  updateMutation: DetailHook["updateMutation"]
  handleSaveChanges: DetailHook["handleSaveChanges"]
  handleToggleClose: DetailHook["handleToggleClose"]
  chatEndRef: RefObject<HTMLDivElement | null>
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
    <div className="flex-1 flex flex-col min-w-0 bg-gray-50/30 dark:bg-slate-800/30" role="complementary" aria-label="Ticket detail">
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
                  <button
                    type="button"
                    className="font-mono text-[10px] text-muted-foreground/60 bg-muted/50 px-1.5 py-0.5 rounded hover:text-primary hover:bg-primary/10 transition-colors cursor-pointer"
                    title="Copy permalink"
                    onClick={() => {
                      const url = `${window.location.origin}/support/${ticketDetail.ticket_number}`
                      navigator.clipboard.writeText(url)
                      toast.success("Permalink copied")
                    }}
                  >
                    {ticketDetail.ticket_number}
                  </button>
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
                  <div className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/15 px-2 py-1 rounded-full border border-amber-200 font-medium">
                    <Clock className="h-3 w-3" />
                    {waitingTime(ticketDetail.created_at)}
                  </div>
                )}
                <SlaBadge ticket={ticketDetail} />
                <StatusBadge status={ticketDetail.status} />
                <PriorityBadge priority={ticketDetail.priority} />
              </div>
            </div>
            {/* SLA + first response stats */}
            {(ticketDetail.first_response_at || ticketDetail.sla_due_at) && (
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                {ticketDetail.first_response_at && ticketDetail.created_at && (
                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-200 font-medium">
                    First response: {formatDuration(
                      new Date(ticketDetail.first_response_at).getTime() -
                      new Date(ticketDetail.created_at).getTime()
                    )}
                  </span>
                )}
                {ticketDetail.sla_due_at && !ticketDetail.first_response_at && (
                  <span className="text-[10px] text-muted-foreground/60 font-medium">
                    SLA due: {new Date(ticketDetail.sla_due_at).toLocaleString()}
                  </span>
                )}
              </div>
            )}
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
                    ? "border-emerald-300 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-500/15"
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
          <ReplyComposer
            replyText={replyText}
            setReplyText={setReplyText}
            showQuickReplies={showQuickReplies}
            setShowQuickReplies={setShowQuickReplies}
            isInternalNote={isInternalNote}
            setIsInternalNote={setIsInternalNote}
            attachedFile={attachedFile}
            setAttachedFile={setAttachedFile}
            fileInputRef={fileInputRef}
            quickReplies={quickReplies}
            replyMutation={replyMutation}
            handleSendReply={handleSendReply}
            handleFileSelect={handleFileSelect}
            handleQuickReplySelect={handleQuickReplySelect}
            queryClient={queryClient}
          />
        </>
      )}
    </div>
  )
}
