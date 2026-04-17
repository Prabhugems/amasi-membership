"use client"

import {
  Search,
  ChevronDown,
  Loader2,
  AlertTriangle,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { CATEGORIES, FILTER_TABS, STATUS_CONFIG } from "../lib/constants"
import type { SupportTicket } from "../lib/types"
import { TicketListItem } from "./TicketListItem"
import { RoutingRulesDialog } from "./RoutingRulesDialog"

/* ---------- Stat pill (compact) ---------- */
function StatPill({
  label,
  count,
  active,
  color,
}: {
  label: string
  count: number
  active?: boolean
  color: string
}) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        active ? color : "bg-muted/40 text-muted-foreground"
      }`}
    >
      <span className="font-bold">{count}</span>
      <span>{label}</span>
    </div>
  )
}

export { StatPill }

export function TicketListPanel({
  sortedTickets,
  stats,
  isLoading,
  isSearching,
  searchQuery,
  handleSearchChange,
  handleSearch,
  statusFilter,
  setStatusFilter,
  categoryFilter,
  setCategoryFilter,
  slaBreachedFilter,
  setSlaBreachedFilter,
  selectedTicketId,
  openTicket,
}: {
  sortedTickets: SupportTicket[]
  stats: { total: number; open: number; in_progress: number; resolved: number }
  isLoading: boolean
  isSearching: boolean
  searchQuery: string
  handleSearchChange: (value: string) => void
  handleSearch: (e: React.FormEvent) => void
  statusFilter: string
  setStatusFilter: (value: string) => void
  categoryFilter: string
  setCategoryFilter: (value: string) => void
  slaBreachedFilter: boolean
  setSlaBreachedFilter: (value: boolean) => void
  selectedTicketId: string | null
  openTicket: (ticket: SupportTicket) => void
}) {
  return (
    <div className="w-[380px] min-w-[320px] border-r flex flex-col bg-white dark:bg-slate-900">
      {/* Search */}
      <div className="p-3 border-b">
        <form onSubmit={handleSearch}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/50" />
            <Input
              placeholder="Search tickets, descriptions, messages..."
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 pr-8 h-9 text-xs bg-gray-50/80 dark:bg-slate-800/60 border-gray-200 dark:border-slate-700 focus:bg-white dark:focus:bg-slate-900 transition-colors"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-teal-500" />
            )}
          </div>
        </form>

        {/* Status filter tabs */}
        <div className="flex gap-1.5 mt-2.5 overflow-x-auto pb-0.5">
          {FILTER_TABS.map((tab) => {
            const isActive = statusFilter === tab.value
            const count =
              tab.value === ""
                ? stats.total
                : stats[tab.value as keyof typeof stats] ?? 0
            return (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-semibold border whitespace-nowrap transition-all duration-150 ${
                  isActive
                    ? tab.color
                    : "bg-white dark:bg-slate-900 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-800/60 hover:text-gray-700 dark:hover:text-slate-300"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span
                    className={`ml-1 text-[9px] px-1.5 py-0.5 rounded-full font-bold ${
                      isActive
                        ? "bg-white/25 text-inherit"
                        : "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400"
                    }`}
                  >
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Category filter + routing rules settings */}
        <div className="mt-2 flex items-center gap-1.5">
          <div className="relative flex-1">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full appearance-none rounded-md border border-gray-200 dark:border-slate-700 bg-gray-50/80 dark:bg-slate-800/60 px-2.5 py-1.5 pr-7 text-[11px] text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">All Categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground/50 pointer-events-none" />
          </div>
          <RoutingRulesDialog />
        </div>

        {/* SLA breached filter */}
        <label className="flex items-center gap-2 mt-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={slaBreachedFilter}
            onChange={(e) => setSlaBreachedFilter(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
          />
          <span className="text-[11px] text-muted-foreground font-medium">
            SLA Breached only
          </span>
        </label>
      </div>

      {/* Scrollable ticket list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && sortedTickets.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <AlertTriangle className="h-6 w-6 text-muted-foreground/30 mb-2" />
            <p className="text-xs text-muted-foreground">
              No tickets match your filters
            </p>
          </div>
        )}
        {sortedTickets.map((ticket) => (
          <TicketListItem
            key={ticket.id}
            ticket={ticket}
            isSelected={ticket.id === selectedTicketId}
            onClick={() => openTicket(ticket)}
          />
        ))}
      </div>

      {/* Bottom count */}
      <div className="px-4 py-2 border-t bg-gray-50/50 dark:bg-slate-800/40 text-[10px] text-muted-foreground/60 font-medium">
        {sortedTickets.length} ticket{sortedTickets.length !== 1 ? "s" : ""}
        {statusFilter && ` (${STATUS_CONFIG[statusFilter]?.label || statusFilter})`}
      </div>
    </div>
  )
}
