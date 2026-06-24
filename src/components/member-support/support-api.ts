import type { MemberTicket, TicketReply } from "./types"
import type { Priority } from "./support-constants"

export interface CreateTicketInput {
  name: string
  email: string
  phone: string
  amasi_number: string
  category: string
  subject: string
  description: string
  priority: Priority
}

export async function listTickets(email: string): Promise<MemberTicket[]> {
  const res = await fetch(`/api/tickets?email=${encodeURIComponent(email)}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

export async function getTicketReplies(ticketId: string): Promise<TicketReply[]> {
  const res = await fetch(`/api/tickets/${ticketId}`)
  const data = await res.json()
  return Array.isArray(data?.replies) ? data.replies : []
}

export async function createTicket(
  input: CreateTicketInput
): Promise<{ ticket_number?: string; id?: string; error?: string }> {
  const res = await fetch("/api/tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return res.json()
}

export async function replyToTicket(
  ticketId: string,
  input: { message: string; authorName: string; file?: File | null }
): Promise<TicketReply> {
  let res: Response
  if (input.file) {
    const fd = new FormData()
    fd.append("message", input.message)
    fd.append("author_name", input.authorName)
    fd.append("as_member", "true")
    fd.append("attachment", input.file)
    res = await fetch(`/api/tickets/${ticketId}/reply`, { method: "POST", body: fd })
  } else {
    res = await fetch(`/api/tickets/${ticketId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: input.message, as_member: true, author_name: input.authorName }),
    })
  }
  return res.json()
}
