export const CATEGORIES = [
  "Application Issue",
  "Profile Update",
  "Payment Issue",
  "Certificate/Card",
  "Technical Issue",
  "Other",
] as const

export const STATUS_OPTIONS = ["open", "in_progress", "resolved", "closed"] as const

export const PRIORITY_OPTIONS = ["low", "normal", "high", "urgent"] as const

export const STATUS_CONFIG: Record<string, { label: string; dotColor: string }> = {
  open:        { label: "Open",        dotColor: "bg-amber-500" },
  in_progress: { label: "In Progress", dotColor: "bg-blue-500" },
  resolved:    { label: "Resolved",    dotColor: "bg-emerald-500" },
  closed:      { label: "Closed",      dotColor: "bg-muted-foreground" },
}

export const PRIORITY_CONFIG: Record<string, { label: string; dotColor: string }> = {
  low:    { label: "Low",    dotColor: "bg-muted-foreground" },
  normal: { label: "Normal", dotColor: "bg-blue-400" },
  high:   { label: "High",   dotColor: "bg-amber-500" },
  urgent: { label: "Urgent", dotColor: "bg-destructive" },
}

export const FILTER_TABS = [
  { value: "", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
] as const

export const FALLBACK_QUICK_REPLIES = [
  {
    label: "Acknowledging",
    text: "We're looking into this and will respond shortly. Thank you for your patience.",
  },
  {
    label: "Need reference #",
    text: "Could you please provide your membership reference number so we can look into this further?",
  },
  {
    label: "Resolved",
    text: "This has been resolved. Please check now and let us know if you face any further issues.",
  },
  {
    label: "Escalated",
    text: "We've escalated this to the technical team. You will be notified once the issue has been addressed.",
  },
  {
    label: "Need screenshot",
    text: "Could you please share a screenshot of the issue you're facing? This will help us resolve it faster.",
  },
  {
    label: "Payment follow-up",
    text: "We've checked with our payment team. Please allow up to 24 hours for the transaction to reflect. If the issue persists, kindly share your transaction ID.",
  },
]

export const ADMIN_ASSIGNEES = [
  "Unassigned",
  "AMASI Admin",
  "Technical Team",
  "Payment Team",
  "Membership Team",
]
