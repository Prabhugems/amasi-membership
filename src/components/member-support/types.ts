export interface MemberTicket {
  id: string
  ticket_number?: string
  subject: string
  status: string
  priority?: string
  category?: string
  created_at?: string
  updated_at?: string
  last_reply_preview?: string
}

export interface TicketReply {
  id?: string
  message?: string
  author_name?: string
  author_role?: string
  as_member?: boolean
  created_at?: string
}
