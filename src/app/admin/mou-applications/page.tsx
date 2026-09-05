"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  ScrollText,
  Loader2,
  AlertTriangle,
  X,
  Filter,
  Download,
  Inbox,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { StatusBadge } from "@/components/mou/status-badge"
import {
  EVENT_TYPE_CONFIG,
  getEventTypeConfig,
  isMouEventTypeConfig,
  SHARED_TYPE_SPECIFIC_COLUMN_KEYS,
  type TypeSpecificFieldDef,
} from "@/lib/mou/event-type-config"
import type { AcademicEventApplication, ApplicationStatus, ApplicationTypeId } from "@/lib/mou/types"
import { isSafeHttpUrl } from "@/lib/mou/safe-url"
import { cn } from "@/lib/utils"

// This page is a record/audit view only (per the design spec's Phase 1 scope
// — "admin /admin/mou-applications as a record/audit view", no
// approve/reject actions here; those live in the Secretary's magic-link
// review flow at /mou/review/[token], Task 9). Real access control is
// src/middleware.ts, which requires the admin JWT cookie for every
// /admin/* page (redirects unauthenticated requests to /login) and 401s the
// underlying /api/admin/mou-applications* routes — same pattern already used
// by src/app/admin/fmas/page.tsx and src/app/admin/mmas/page.tsx, neither of
// which duplicates that check client-side with useAdminRole(). The global
// Sidebar's `adminRole === null` gate keeps the nav entry itself from
// leaking to non-admins (AGENTS.md "Admin UI gating" — info-leak hygiene,
// not the security boundary).

interface ListResponse {
  status: boolean
  rows: AcademicEventApplication[]
  total: number
}

interface Remark {
  id?: string
  author_name: string
  author_role: string
  body: string
  created_at: string
}

interface DetailResponse {
  status: boolean
  application: AcademicEventApplication
  remarks: Remark[]
  hasSignature: boolean | null
}

const STATUSES: ApplicationStatus[] = [
  "submitted",
  "under_review",
  "changes_requested",
  "approved",
  "rejected",
]

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  submitted: "Submitted",
  under_review: "Under review",
  changes_requested: "Changes requested",
  approved: "Approved",
  rejected: "Rejected",
}

const TYPE_OPTIONS = Object.values(EVENT_TYPE_CONFIG)

const PAGE_SIZE = 50
// The "approved, sorted by finalized date" view substitutes for a full
// calendar widget per the design spec — fetch a generous page so the
// client-side date sort covers the whole approved set rather than just one
// page of it. 200 is the API's own MAX_LIMIT (see
// src/app/api/admin/mou-applications/route.ts).
const APPROVED_VIEW_LIMIT = 200

function formatDate(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function formatDateTime(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function eventLabel(app: AcademicEventApplication): string {
  return app.event_name || getEventTypeConfig(app.application_type_id)?.label || app.application_type_id
}

function Stat({
  label,
  value,
  active,
  onClick,
}: {
  label: string
  value: number | string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "text-left border rounded-md p-4 bg-card transition-colors",
        onClick && "hover:border-primary/50 cursor-pointer",
        active && "border-primary ring-1 ring-primary/30"
      )}
    >
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums leading-none">
        {value}
      </div>
    </button>
  )
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="mt-0.5 text-sm">{value || <span className="text-muted-foreground">—</span>}</div>
    </div>
  )
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<DetailResponse>({
    queryKey: ["mou-admin-detail", id],
    queryFn: async () => {
      const res = await fetch(`/api/admin/mou-applications/${id}`)
      if (!res.ok) throw new Error("Failed to load application")
      return res.json()
    },
  })

  const app = data?.application
  const remarks = data?.remarks ?? []

  const hasSignature = data?.hasSignature ?? null
  const typeConfig = app ? getEventTypeConfig(app.application_type_id) : null
  const isMouFramework = !!typeConfig && isMouEventTypeConfig(typeConfig)

  // The migration adding type_specific_data (sql/040) has not been applied
  // to any database yet, so existing rows (and any pre-migration DB state)
  // won't have this column — app.type_specific_data can be undefined, not
  // just an empty object. Fall back to {} everywhere it's read rather than
  // dereferencing it directly at each site.
  const typeSpecificData = (app?.type_specific_data ?? {}) as Record<string, unknown>

  function typeSpecificValue(field: TypeSpecificFieldDef): string | null {
    if (!app) return null
    if (field.kind === "facilities-group") {
      const group = (typeSpecificData.facilities ?? {}) as Record<string, unknown>
      return field.items
        .filter((i) => group[i.key])
        .map((i) => (i.kind === "checkbox" ? i.label : `${i.label}: ${group[i.key]}`))
        .join(" · ") || null
    }
    const value = SHARED_TYPE_SPECIFIC_COLUMN_KEYS.has(field.key)
      ? (app as unknown as Record<string, unknown>)[field.key]
      : typeSpecificData[field.key]
    if (value === undefined || value === null || value === "") return null
    return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
  }

  const facilities = app
    ? [
        app.auditorium_hall_a && "Auditorium — Hall A",
        app.auditorium_hall_b && "Auditorium — Hall B",
        app.av_equipment && "AV equipment",
        app.endotrainers && "Endotrainers",
        app.high_speed_internet && "High-speed internet",
      ].filter(Boolean)
    : []

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-10 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}
        {isError && (
          <div className="flex items-center gap-2 text-sm text-destructive py-10 justify-center">
            <AlertTriangle className="h-4 w-4" />
            Failed to load application.
          </div>
        )}
        {app && (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2 flex-wrap">
                <DialogTitle>{eventLabel(app)}</DialogTitle>
                <StatusBadge status={app.status} />
              </div>
              <DialogDescription>
                {getEventTypeConfig(app.application_type_id)?.label} — submitted by {app.organizer_name}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="rounded-md border border-border p-4">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Organizer
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Organizer" value={app.organizer_name} />
                  <Field label="AMASI #" value={app.applicant_amasi_number} />
                  <Field label="Email" value={app.email} />
                  <Field label="Phone" value={app.phone_number} />
                  <Field label="Institution" value={app.primary_institution} />
                  <Field label="Zone" value={app.zone} />
                </div>
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Venue &amp; schedule
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Preferred date 1" value={formatDate(app.preferred_date_1)} />
                  <Field label="Preferred date 2" value={formatDate(app.preferred_date_2)} />
                  <Field label="Finalized date" value={formatDate(app.finalized_date)} />
                  <Field label="Expected participants" value={app.expected_participants} />
                  <Field label="Venue" value={app.venue_name} />
                  <Field
                    label="Location"
                    value={[app.venue_city, app.venue_state, app.venue_country].filter(Boolean).join(", ")}
                  />
                  <Field label="Address" value={app.venue_address} />
                  <Field label="Live surgery demo" value={app.live_surgery_demo === null ? null : app.live_surgery_demo ? "Yes" : "No"} />
                </div>
                {facilities.length > 0 && (
                  <div className="mt-3">
                    <Field label="Facilities requested" value={facilities.join(" · ")} />
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border p-4">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Review &amp; decision
                </h3>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Reviewed by" value={app.reviewed_by} />
                  <Field label="Reviewed at" value={formatDateTime(app.reviewed_at)} />
                  {app.status === "rejected" && (
                    <div className="col-span-2">
                      <Field label="Rejection reason" value={app.rejection_reason} />
                    </div>
                  )}
                  {app.admin_notes && (
                    <div className="col-span-2">
                      <Field label="Admin notes" value={app.admin_notes} />
                    </div>
                  )}
                </div>
              </div>

              {isMouFramework && typeConfig && "typeSpecificFields" in typeConfig && (
                <div className="rounded-md border border-border p-4">
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                    {typeConfig.label} details
                  </h3>
                  <div className="grid grid-cols-2 gap-3">
                    {typeConfig.typeSpecificFields
                      .filter((f) => f.kind !== "faculty-rows" && f.kind !== "association-rows" && f.kind !== "conditional-upload")
                      .map((f) => {
                        const value = typeSpecificValue(f)
                        return value ? <Field key={f.key} label={f.kind === "facilities-group" ? "Facilities" : f.label} value={value} /> : null
                      })}
                  </div>

                  {/* faculty-rows/association-rows/conditional-upload are
                      deliberately excluded from the generic grid above (they
                      aren't simple scalar values) but must still be shown
                      somewhere — an admin reviewing an application couldn't
                      otherwise see who the faculty are, which associations
                      are involved, or open the uploaded documents. */}
                  {app.faculty && app.faculty.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                        Faculty
                      </div>
                      <div className="space-y-1.5">
                        {app.faculty.map((f, i) => (
                          <div key={i} className="text-sm border rounded-md p-2">
                            <span className="font-medium">{f.name}</span>
                            {f.amasi_membership_number && (
                              <span className="text-muted-foreground"> · AMASI #{f.amasi_membership_number}</span>
                            )}
                            {f.speciality && <span className="text-muted-foreground"> · {f.speciality}</span>}
                            <span className="text-muted-foreground"> · {f.is_amasi_member ? "AMASI member" : "Non-member"}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {app.partner_associations && app.partner_associations.length > 0 && (
                    <div className="mt-3">
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                        Partner associations
                      </div>
                      <div className="space-y-1.5">
                        {app.partner_associations.map((a, i) => (
                          <div key={i} className="text-sm border rounded-md p-2 flex items-center justify-between gap-2">
                            <span className="font-medium">{a.name}</span>
                            {isSafeHttpUrl(a.consent_letter_url) && (
                              <a
                                href={a.consent_letter_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                              >
                                <Download className="h-3.5 w-3.5" />
                                Consent letter
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {typeConfig.typeSpecificFields
                    .filter((f): f is Extract<TypeSpecificFieldDef, { kind: "conditional-upload" }> => f.kind === "conditional-upload")
                    .map((f) => {
                      const url = (app as unknown as Record<string, unknown>)[`${f.docType}_url`]
                      if (!isSafeHttpUrl(url)) return null
                      return (
                        <div key={f.key} className="mt-3">
                          <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                            {f.label}
                          </div>
                          <Button asChild variant="outline" size="sm" className="gap-1.5">
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <Download className="h-3.5 w-3.5" />
                              Open document
                            </a>
                          </Button>
                        </div>
                      )
                    })}

                  {/* Prominent flags per the design spec's admin-view section */}
                  {app.application_type_id === "rural_program" && typeSpecificData.financial_assistance_requested === true && (
                    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                      Financial assistance requested (up to ₹1,00,000)
                    </div>
                  )}
                  {app.application_type_id === "workshop" && typeSpecificData.small_state_exception_requested === true && (
                    <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                      Small-state faculty transport requested (clause 17) — this costs AMASI money. State: {String(typeSpecificData.venue_state ?? app.venue_state)}, faculty count: {String(typeSpecificData.small_state_faculty_count ?? "—")}
                    </div>
                  )}
                  {hasSignature === false && (
                    <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 text-sm text-destructive">
                      Anomaly: no matching electronic-signature record found for this application.
                    </div>
                  )}
                </div>
              )}

              {app.status === "approved" && (
                <div className="rounded-md border border-border p-4">
                  <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                    MOU
                  </h3>
                  {app.mou_generated_url ? (
                    <Button asChild variant="outline" size="sm" className="gap-1.5">
                      <a href={app.mou_generated_url} target="_blank" rel="noopener noreferrer">
                        <Download className="h-3.5 w-3.5" />
                        Download MOU (v{app.mou_version})
                      </a>
                    </Button>
                  ) : (
                    <p className="text-sm text-muted-foreground">MOU not generated yet.</p>
                  )}
                </div>
              )}

              <div className="rounded-md border border-border p-4">
                <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                  Remarks
                </h3>
                {remarks.length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No remarks on file.</p>
                ) : (
                  <div className="space-y-2">
                    {remarks.map((r, i) => (
                      <div key={r.id ?? i} className="border rounded-md p-3 text-sm">
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground mb-1">
                          <span className="font-semibold text-foreground">
                            {r.author_name} <span className="font-normal text-muted-foreground">· {r.author_role}</span>
                          </span>
                          <span>{formatDateTime(r.created_at)}</span>
                        </div>
                        <p>{r.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function AdminMouApplicationsPage() {
  const [typeFilter, setTypeFilter] = useState<ApplicationTypeId | "">("")
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "">("")
  const [view, setView] = useState<"list" | "approved">("list")
  const [offset, setOffset] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const effectiveStatus = view === "approved" ? "approved" : statusFilter || undefined
  const effectiveLimit = view === "approved" ? APPROVED_VIEW_LIMIT : PAGE_SIZE
  const effectiveOffset = view === "approved" ? 0 : offset

  const listQuery = useQuery<ListResponse>({
    queryKey: ["mou-admin-list", typeFilter, effectiveStatus, effectiveOffset, effectiveLimit],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (typeFilter) params.set("type", typeFilter)
      if (effectiveStatus) params.set("status", effectiveStatus)
      params.set("limit", String(effectiveLimit))
      params.set("offset", String(effectiveOffset))
      const res = await fetch(`/api/admin/mou-applications?${params.toString()}`)
      if (!res.ok) throw new Error("Failed to load applications")
      return res.json()
    },
  })

  // Per-status totals for the stat row. Each call asks for limit=1 — we only
  // need the API's `count: "exact"` total, not the rows — same
  // count-only-fetch shape as /api/admin/orphan-payments?count=1.
  const statsQuery = useQuery<Record<ApplicationStatus, number>>({
    queryKey: ["mou-admin-stats"],
    queryFn: async () => {
      const entries = await Promise.all(
        STATUSES.map(async (s) => {
          const res = await fetch(`/api/admin/mou-applications?status=${s}&limit=1`)
          if (!res.ok) return [s, 0] as const
          const json: ListResponse = await res.json()
          return [s, json.total ?? 0] as const
        })
      )
      return Object.fromEntries(entries) as Record<ApplicationStatus, number>
    },
  })

  const rows = useMemo(() => {
    const r = listQuery.data?.rows ?? []
    if (view !== "approved") return r
    // Calendar-substitute sort: finalized_date ascending, undated approved
    // applications (shouldn't normally happen post-approval, but the column
    // is nullable) sink to the bottom rather than disappearing.
    return [...r].sort((a, b) => {
      if (!a.finalized_date && !b.finalized_date) return 0
      if (!a.finalized_date) return 1
      if (!b.finalized_date) return -1
      return a.finalized_date.localeCompare(b.finalized_date)
    })
  }, [listQuery.data, view])

  const total = listQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const totalAll = STATUSES.reduce((sum, s) => sum + (statsQuery.data?.[s] ?? 0), 0)

  const hasActiveFilters = typeFilter !== "" || statusFilter !== ""

  const resetFilters = () => {
    setTypeFilter("")
    setStatusFilter("")
    setOffset(0)
  }

  return (
    <div className="space-y-6">
      {/* Eyebrow + title */}
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-md border bg-card flex items-center justify-center shrink-0">
          <ScrollText className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
            Academic Event MOU Workflow
          </p>
          <h1 className="text-2xl font-bold tracking-tight">MOU Applications</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Record and audit view of academic event hosting applications — {totalAll.toLocaleString("en-IN")} total.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {STATUSES.map((s) => (
          <Stat
            key={s}
            label={STATUS_LABELS[s]}
            value={statsQuery.isLoading ? "—" : (statsQuery.data?.[s] ?? 0).toLocaleString("en-IN")}
            active={view === "list" && statusFilter === s}
            onClick={() => {
              setView("list")
              setStatusFilter((prev) => (prev === s ? "" : s))
              setOffset(0)
            }}
          />
        ))}
      </div>

      {/* View toggle */}
      <div className="flex items-center gap-2 border-b pb-2">
        <Button
          variant={view === "list" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => {
            setView("list")
            setOffset(0)
          }}
        >
          All applications
        </Button>
        <Button
          variant={view === "approved" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setView("approved")}
        >
          Approved · by event date
        </Button>
      </div>

      {/* Filters */}
      <div className="border rounded-md bg-card p-3 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
          <Filter className="h-3.5 w-3.5" />
          Filter
        </div>
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as ApplicationTypeId | "")
            setOffset(0)
          }}
          className="text-xs h-8 border rounded-md px-2 bg-background hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All types</option>
          {TYPE_OPTIONS.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          disabled={view === "approved"}
          onChange={(e) => {
            setStatusFilter(e.target.value as ApplicationStatus | "")
            setOffset(0)
          }}
          className="text-xs h-8 border rounded-md px-2 bg-background hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="h-8 text-xs gap-1">
            <X className="h-3 w-3" />
            Reset
          </Button>
        )}
        <div className="ml-auto text-xs text-muted-foreground tabular-nums">
          {listQuery.isLoading
            ? "Loading…"
            : view === "approved"
              ? `${rows.length.toLocaleString("en-IN")} approved`
              : `Showing ${rows.length.toLocaleString("en-IN")} of ${total.toLocaleString("en-IN")}`}
        </div>
      </div>

      {/* Table */}
      {listQuery.isLoading ? (
        <div className="border rounded-md p-16 text-center bg-card">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Loading applications…</p>
        </div>
      ) : listQuery.isError ? (
        <div className="border rounded-md p-12 text-center bg-card">
          <AlertTriangle className="h-8 w-8 mx-auto text-destructive" />
          <p className="font-semibold mt-2">Failed to load</p>
          <p className="text-sm text-muted-foreground mt-1">Try refreshing the page.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="border rounded-md p-16 text-center bg-card">
          <div className="h-10 w-10 rounded-md bg-muted border flex items-center justify-center mx-auto mb-3">
            <Inbox className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="font-semibold">No applications</p>
          <p className="text-sm text-muted-foreground mt-1">
            {hasActiveFilters || view === "approved" ? "Try adjusting filters or the view." : "No academic event applications yet."}
          </p>
        </div>
      ) : (
        <div className="border rounded-md overflow-hidden bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Type
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Organizer
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                    Institution
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Date
                  </th>
                  <th className="text-left px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="text-right px-4 py-2.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    MOU
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((app) => (
                  <tr
                    key={app.id}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => setSelectedId(app.id)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{getEventTypeConfig(app.application_type_id)?.label ?? app.application_type_id}</div>
                      {app.event_name && (
                        <div className="text-xs text-muted-foreground truncate max-w-[200px]">{app.event_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium truncate max-w-[180px]">{app.organizer_name}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[180px]">{app.email}</div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell truncate max-w-[200px]">
                      {app.primary_institution}
                    </td>
                    <td className="px-4 py-3">
                      {app.finalized_date ? (
                        <div>
                          <div className="font-medium">{formatDate(app.finalized_date)}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">confirmed</div>
                        </div>
                      ) : (
                        <div>
                          <div>{formatDate(app.preferred_date_1)}</div>
                          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">requested</div>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={app.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {app.status === "approved" && app.mou_generated_url ? (
                        <a
                          href={app.mou_generated_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" />
                          MOU
                        </a>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination — list view only; the approved view shows the whole
              set at once (up to APPROVED_VIEW_LIMIT) since it stands in for
              a calendar, not a paged table. */}
          {view === "list" && totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
              <div className="text-xs text-muted-foreground tabular-nums">
                Page {currentPage} of {totalPages.toLocaleString("en-IN")}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={offset === 0}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setOffset((o) => (o + PAGE_SIZE < total ? o + PAGE_SIZE : o))}
                  disabled={offset + PAGE_SIZE >= total}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {selectedId && <DetailDialog id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  )
}
