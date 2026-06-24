"use client"
import { useCallback, useEffect, useState } from "react"
import { listTickets, getTicketReplies } from "./support-api"
import type { MemberTicket, TicketReply } from "./types"

export function useMemberTickets(email: string | undefined, refreshKey: number) {
  const [tickets, setTickets] = useState<MemberTicket[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [replies, setReplies] = useState<TicketReply[]>([])
  const [repliesLoading, setRepliesLoading] = useState(false)

  const reload = useCallback(() => {
    if (!email) return
    setLoading(true); setLoadError(false)
    listTickets(email)
      .then(setTickets)
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [email])

  useEffect(() => { reload() }, [reload, refreshKey])

  const loadReplies = useCallback(async (ticketId: string) => {
    setReplies([]); setRepliesLoading(true)
    try { setReplies(await getTicketReplies(ticketId)) }
    catch { setReplies([]) }
    finally { setRepliesLoading(false) }
  }, [])

  return { tickets, loading, loadError, replies, repliesLoading, loadReplies, setReplies, reload }
}
