export interface TicketAttachment {
  url: string
  filename: string
  size: number
}

export interface Ticket {
  id: string
  ticket_number: string
  name: string
  email: string
  phone: string | null
  amasi_number: string | null
  category: string
  subject: string
  description: string
  status: string
  priority?: string
  attachments?: TicketAttachment[]
  created_at: string
}

export interface Reply {
  id: string
  ticket_id: string
  author_name: string
  message: string
  is_admin: boolean
  is_internal?: boolean
  attachments?: TicketAttachment[]
  created_at: string
}

export const CATEGORIES = [
  { value: "Application Issue", description: "Submission errors, missing fields, stuck applications" },
  { value: "Profile Update", description: "Name, address, qualification, or photo changes" },
  { value: "Payment Issue", description: "Refunds, failed transactions, receipts" },
  { value: "Certificate/Card", description: "Membership card or certificate requests" },
  { value: "Technical Issue", description: "Login problems, OTP errors, site bugs" },
  { value: "Other", description: "Anything not listed above" },
]

export const PRIORITIES = [
  { value: "low", label: "Low", description: "General inquiry, no urgency" },
  { value: "normal", label: "Normal", description: "Standard support request" },
  { value: "high", label: "High", description: "Blocking issue, needs prompt attention" },
]

export const DESCRIPTION_MAX = 2000
export const MAX_ATTACHMENTS = 3
export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const ALLOWED_FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"]
