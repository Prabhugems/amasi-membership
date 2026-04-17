"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import type { SupportTicket } from "../lib/types"
import { getSlaStatus, hasUnreadMemberReply } from "../lib/ticket-utils"

export function useTicketList({
  statusFilter,
  categoryFilter,
  slaBreachedFilter,
  debouncedServerQuery,
  searchTerm,
}: {
  statusFilter: string
  categoryFilter: string
  slaBreachedFilter: boolean
  debouncedServerQuery: string
  searchTerm: string
}) {
  /* ---- fetch all tickets ---- */
  const { data: allTickets = [], isLoading } = useQuery<SupportTicket[]>({
    queryKey: ["tickets-all"],
    queryFn: async () => {
      const res = await fetch("/api/tickets?all=1")
      if (!res.ok) throw new Error("Failed to fetch tickets")
      const json = await res.json()
      return Array.isArray(json) ? json : []
    },
  })

  /* ---- server-side full-text search (3+ chars, debounced) ---- */
  const { data: serverSearchResults, isFetching: isSearching } = useQuery<SupportTicket[]>({
    queryKey: ["tickets-search", debouncedServerQuery, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ all: "1", q: debouncedServerQuery })
      if (statusFilter) params.set("status", statusFilter)
      const res = await fetch(`/api/tickets?${params.toString()}`)
      if (!res.ok) throw new Error("Search failed")
      const json = await res.json()
      return Array.isArray(json) ? json : []
    },
    enabled: debouncedServerQuery.length >= 3,
    placeholderData: (prev) => prev,
  })
  const useServerResults = debouncedServerQuery.length >= 3 && serverSearchResults !== undefined

  /* ---- filtered tickets ---- */
  const sortedTickets = useMemo(() => {
    const baseTickets = useServerResults ? (serverSearchResults ?? []) : allTickets
    const filteredTickets = baseTickets.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false
      if (categoryFilter && t.category !== categoryFilter) return false
      if (slaBreachedFilter) {
        const sla = getSlaStatus(t)
        if (sla.type !== "breached") return false
      }
      if (searchTerm && !useServerResults) {
        const q = searchTerm.toLowerCase()
        const haystack =
          `${t.ticket_number} ${t.name} ${t.email} ${t.subject}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    // Sort: urgent/high first, then unread, then by date
    return [...filteredTickets].sort((a, b) => {
      const priorityOrder: Record<string, number> = {
        urgent: 0,
        high: 1,
        normal: 2,
        low: 3,
      }
      const pA = priorityOrder[a.priority] ?? 2
      const pB = priorityOrder[b.priority] ?? 2
      if (pA !== pB) return pA - pB
      // Unread first within same priority
      const uA = hasUnreadMemberReply(a) ? 0 : 1
      const uB = hasUnreadMemberReply(b) ? 0 : 1
      if (uA !== uB) return uA - uB
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })
  }, [allTickets, serverSearchResults, useServerResults, statusFilter, categoryFilter, slaBreachedFilter, searchTerm])

  /* ---- stats ---- */
  const stats = useMemo(() => ({
    total: allTickets.length,
    open: allTickets.filter((t) => t.status === "open").length,
    in_progress: allTickets.filter((t) => t.status === "in_progress").length,
    resolved: allTickets.filter((t) => t.status === "resolved").length,
  }), [allTickets])

  return { sortedTickets, stats, isLoading, isSearching }
}
