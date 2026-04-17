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

export const STATUS_CONFIG: Record<
  string,
  { label: string; variant: string; className: string; dotColor: string; tabBg: string; tabText: string }
> = {
  open: {
    label: "Open",
    variant: "warning",
    className: "bg-amber-50 text-amber-700 border-amber-200 soft-pulse",
    dotColor: "bg-amber-500",
    tabBg: "bg-amber-50 border-amber-200 hover:bg-amber-100",
    tabText: "text-amber-700",
  },
  in_progress: {
    label: "In Progress",
    variant: "default",
    className: "bg-blue-50 text-blue-700 border-blue-200 soft-pulse",
    dotColor: "bg-blue-500",
    tabBg: "bg-blue-50 border-blue-200 hover:bg-blue-100",
    tabText: "text-blue-700",
  },
  resolved: {
    label: "Resolved",
    variant: "success",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotColor: "bg-emerald-500",
    tabBg: "bg-emerald-50 border-emerald-200 hover:bg-emerald-100",
    tabText: "text-emerald-700",
  },
  closed: {
    label: "Closed",
    variant: "secondary",
    className: "bg-gray-100 dark:bg-slate-800 text-gray-500 dark:text-slate-400 border-gray-200 dark:border-slate-700",
    dotColor: "bg-gray-400",
    tabBg: "bg-gray-50 dark:bg-slate-800/60 border-gray-200 dark:border-slate-700 hover:bg-gray-100 dark:hover:bg-slate-800",
    tabText: "text-gray-500 dark:text-slate-400",
  },
}

export const PRIORITY_CONFIG: Record<
  string,
  { label: string; className: string; borderColor: string; dotColor: string }
> = {
  low: {
    label: "Low",
    className: "bg-gray-50 dark:bg-slate-800/60 text-gray-600 dark:text-slate-400 border-gray-200 dark:border-slate-700",
    borderColor: "border-l-gray-300",
    dotColor: "bg-gray-400",
  },
  normal: {
    label: "Normal",
    className: "bg-blue-50 text-blue-600 border-blue-200",
    borderColor: "border-l-blue-400",
    dotColor: "bg-blue-400",
  },
  high: {
    label: "High",
    className: "bg-amber-50 text-amber-700 border-amber-200",
    borderColor: "border-l-amber-500",
    dotColor: "bg-amber-500",
  },
  urgent: {
    label: "Urgent",
    className: "bg-red-50 text-red-700 border-red-200",
    borderColor: "border-l-red-500",
    dotColor: "bg-red-500",
  },
}

export const FILTER_TABS = [
  { value: "", label: "All", color: "bg-gray-800 text-white border-gray-800" },
  { value: "open", label: "Open", color: "bg-amber-600 text-white border-amber-600" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-600 text-white border-blue-600" },
  { value: "resolved", label: "Resolved", color: "bg-emerald-600 text-white border-emerald-600" },
  { value: "closed", label: "Closed", color: "bg-gray-500 text-white border-gray-500" },
]

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
