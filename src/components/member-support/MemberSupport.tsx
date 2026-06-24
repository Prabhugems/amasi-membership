"use client"
import { useState } from "react"
import { useMemberTickets } from "./useMemberTickets"
import TicketList from "./TicketList"
import NewTicketForm, { type MemberCtx } from "./NewTicketForm"
import TicketConversation from "./TicketConversation"
import type { MemberTicket, TicketReply } from "./types"

export default function MemberSupport({ member }: { member: MemberCtx }) {
  const [view, setView] = useState<"list" | "new" | "detail">("list")
  const [selected, setSelected] = useState<MemberTicket | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const { tickets, loading, loadError, replies, repliesLoading, loadReplies, setReplies, reload } =
    useMemberTickets(member.email, refreshKey)

  const open = (t: MemberTicket) => { setSelected(t); setView("detail"); loadReplies(t.id) }
  const created = () => { setView("list"); setRefreshKey((k) => k + 1) }

  if (view === "new") {
    return <NewTicketForm member={member} onBack={() => setView("list")} onCreated={created} />
  }
  if (view === "detail" && selected) {
    return (
      <TicketConversation
        ticket={selected}
        replies={replies}
        repliesLoading={repliesLoading}
        memberName={member.name || member.first_name || "Member"}
        onBack={() => { setView("list"); setSelected(null) }}
        onReplyAdded={(r: TicketReply) => setReplies((prev) => [...prev, r])}
        onReopened={() => { setSelected((s) => (s ? { ...s, status: "open" } : s)); setRefreshKey((k) => k + 1) }}
      />
    )
  }
  return (
    <TicketList
      tickets={tickets}
      loading={loading}
      loadError={loadError}
      onOpen={open}
      onNew={() => setView("new")}
      onRetry={reload}
    />
  )
}
