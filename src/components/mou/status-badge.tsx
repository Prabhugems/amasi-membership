import { cn } from "@/lib/utils"
import type { ApplicationStatus } from "@/lib/mou/types"

// Status shown as a small colored dot + lowercase text, not a filled chip —
// AGENTS.md §3 "Required patterns". Colors come from the CSS variables in
// src/app/globals.css (--success/--warning/--destructive/--muted-foreground),
// never hardcoded hex.
const STATUS_CONFIG: Record<ApplicationStatus, { label: string; dotClassName: string }> = {
  submitted: { label: "submitted", dotClassName: "bg-muted-foreground" },
  under_review: { label: "under review", dotClassName: "bg-warning" },
  changes_requested: { label: "changes requested", dotClassName: "bg-warning" },
  approved: { label: "approved", dotClassName: "bg-success" },
  rejected: { label: "rejected", dotClassName: "bg-destructive" },
}

export function StatusBadge({
  status,
  className,
}: {
  status: ApplicationStatus
  className?: string
}) {
  const config = STATUS_CONFIG[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-medium text-foreground", className)}>
      <span aria-hidden="true" className={cn("inline-block h-2 w-2 rounded-full", config.dotClassName)} />
      {config.label}
    </span>
  )
}
