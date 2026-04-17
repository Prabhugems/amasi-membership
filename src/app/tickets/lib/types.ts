export interface ReplyTemplate {
  id: string
  title: string
  body: string
  created_by: string | null
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TicketAttachment {
  url: string
  filename: string
  size: number
}

export interface TicketReply {
  id: string
  ticket_id: string
  message: string
  is_admin: boolean
  is_internal?: boolean
  author_name: string
  attachments?: TicketAttachment[]
  created_at: string
}

export interface SupportTicket {
  id: string
  ticket_number: string
  name: string
  email: string
  subject: string
  description: string
  category: string
  status: string
  priority: string
  assigned_to?: string
  attachments?: TicketAttachment[]
  created_at: string
  updated_at: string
  first_response_at?: string | null
  sla_due_at?: string | null
  sla_breached?: boolean
  csat_rating?: number | null
  merged_into?: string | null
  merged_at?: string | null
  replies?: TicketReply[]
}

export interface RoutingRule {
  id: string
  category: string
  assigned_to: string
  priority_override: string | null
  active: boolean
  created_at: string
}
