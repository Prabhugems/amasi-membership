"use client"

import { Suspense, useState } from "react"
import Link from "next/link"
import { Ticket, BarChart3, Loader2 } from "lucide-react"
import { useDebouncedSearch } from "./hooks/useDebouncedSearch"
import { useTicketList } from "./hooks/useTicketList"
import { useTicketDetail } from "./hooks/useTicketDetail"
import { StatPill } from "./components/TicketListPanel"
import { TicketListPanel } from "./components/TicketListPanel"
import { TicketDetailPanel } from "./components/TicketDetailPanel"

/* ---------- main component ---------- */

function TicketsContent() {
  // filters
  const [statusFilter, setStatusFilter] = useState("")
  const [categoryFilter, setCategoryFilter] = useState("")
  const [slaBreachedFilter, setSlaBreachedFilter] = useState(false)

  // search
  const {
    searchQuery,
    searchTerm,
    debouncedServerQuery,
    handleSearchChange,
    handleSearch,
  } = useDebouncedSearch()

  // ticket list
  const { sortedTickets, stats, isLoading, isSearching } = useTicketList({
    statusFilter,
    categoryFilter,
    slaBreachedFilter,
    debouncedServerQuery,
    searchTerm,
  })

  // ticket detail
  const detail = useTicketDetail()

  /* ===================== ALWAYS SPLIT INBOX ===================== */
  return (
    <div className="space-y-0">
      {/* Top bar: title + stats */}
      <div className="flex items-center justify-between px-1 pb-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-teal-600 flex items-center justify-center shadow-sm">
              <Ticket className="h-5 w-5 text-white" />
            </div>
            Support Tickets
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5 ml-[46px]">
            Manage and respond to member support requests
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatPill
            label="Open"
            count={stats.open}
            active={stats.open > 0}
            color="bg-amber-100 text-amber-800"
          />
          <StatPill
            label="In Progress"
            count={stats.in_progress}
            active={stats.in_progress > 0}
            color="bg-blue-100 text-blue-800"
          />
          <StatPill
            label="Resolved"
            count={stats.resolved}
            active={stats.resolved > 0}
            color="bg-emerald-100 text-emerald-800"
          />
          <div className="h-5 w-px bg-border mx-1" />
          <span className="text-xs text-muted-foreground font-medium">
            {stats.total} total
          </span>
          <div className="h-5 w-px bg-border mx-1" />
          <Link
            href="/tickets/analytics"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            Analytics
          </Link>
        </div>
      </div>

      {/* Split layout container */}
      <div
        className="flex rounded-xl border overflow-hidden shadow-sm bg-card"
        style={{ height: "calc(100vh - 160px)" }}
      >
        {/* Left Panel: Ticket List */}
        <TicketListPanel
          sortedTickets={sortedTickets}
          stats={stats}
          isLoading={isLoading}
          isSearching={isSearching}
          searchQuery={searchQuery}
          handleSearchChange={handleSearchChange}
          handleSearch={handleSearch}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          categoryFilter={categoryFilter}
          setCategoryFilter={setCategoryFilter}
          slaBreachedFilter={slaBreachedFilter}
          setSlaBreachedFilter={setSlaBreachedFilter}
          selectedTicketId={detail.selectedTicketId}
          openTicket={detail.openTicket}
        />

        {/* Right Panel: Ticket Detail */}
        <TicketDetailPanel
          selectedTicketId={detail.selectedTicketId}
          ticketDetail={detail.ticketDetail}
          detailLoading={detail.detailLoading}
          editStatus={detail.editStatus}
          setEditStatus={detail.setEditStatus}
          editPriority={detail.editPriority}
          setEditPriority={detail.setEditPriority}
          editAssignee={detail.editAssignee}
          setEditAssignee={detail.setEditAssignee}
          updateMutation={detail.updateMutation}
          handleSaveChanges={detail.handleSaveChanges}
          handleToggleClose={detail.handleToggleClose}
          chatEndRef={detail.chatEndRef}
          replyText={detail.replyText}
          setReplyText={detail.setReplyText}
          showQuickReplies={detail.showQuickReplies}
          setShowQuickReplies={detail.setShowQuickReplies}
          isInternalNote={detail.isInternalNote}
          setIsInternalNote={detail.setIsInternalNote}
          attachedFile={detail.attachedFile}
          setAttachedFile={detail.setAttachedFile}
          fileInputRef={detail.fileInputRef}
          quickReplies={detail.quickReplies}
          replyMutation={detail.replyMutation}
          handleSendReply={detail.handleSendReply}
          handleFileSelect={detail.handleFileSelect}
          handleQuickReplySelect={detail.handleQuickReplySelect}
          queryClient={detail.queryClient}
        />
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
          <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
        </div>
      }
    >
      <TicketsContent />
    </Suspense>
  )
}
