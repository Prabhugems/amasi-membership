"use client"

// Admin queue for event-hosting (MOU) applications.
//
// Table + filters follow src/app/admin/orphan-payments/page.tsx; the review
// panel adapts design-references/tailwind-plus/drawer-wide-create-project-form.tsx
// (sticky header, scrollable body, sticky footer) onto our Radix Dialog.

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { AlertTriangle, ExternalLink, FileSignature, Loader2, RefreshCw, Search, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import {
  MOU_ATTACHMENT_LABELS,
  MOU_EVENTS,
  MOU_EVENT_TYPES,
  MOU_STATUSES,
  MOU_STATUS_META,
  MOU_VENUE_TYPES,
  type MouAttachmentKey,
  type MouEventType,
  type MouStatus,
} from "@/lib/mou-events"

interface ListRow {
  id: string
  reference_number: string
  event_type: MouEventType
  status: MouStatus
  amasi_number: number | null
  applicant_name: string
  applicant_email: string
  applicant_phone: string | null
  event_title: string | null
  proposed_date: string | null
  proposed_end_date: string | null
  proposed_year: number | null
  place: string
  state: string | null
  venue_name: string | null
  attachment_count: number
  has_signed_mou: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

interface DetailRow extends ListRow {
  applicant_address: string | null
  member_since: string | null
  venue_type: "institution" | "guest" | "private" | null
  joint_with_association: boolean
  partner_association: string | null
  supporting_city_chapter: string | null
  supporting_state_chapter: string | null
  supporting_others: string | null
  remarks: string | null
  details: Record<string, string | number>
  declarations: Record<string, true>
  attachments: { key: MouAttachmentKey; filename: string; size: number; url: string | null }[]
  admin_notes: string | null
  decision_reason: string | null
  signed_mou_url: string | null
  signed_mou_at: string | null
}

type StatusFilter = "open" | "all" | MouStatus

// Mirrors ALLOWED_TRANSITIONS in the API; the server is authoritative.
const NEXT_ACTIONS: Record<MouStatus, { to: MouStatus; label: string; variant?: "default" | "outline" | "destructive" | "success" }[]> = {
  submitted: [
    { to: "under_review", label: "Mark under review", variant: "outline" },
    { to: "approved", label: "Approve", variant: "success" },
    { to: "rejected", label: "Reject", variant: "destructive" },
  ],
  under_review: [
    { to: "approved", label: "Approve", variant: "success" },
    { to: "rejected", label: "Reject", variant: "destructive" },
  ],
  approved: [
    { to: "mou_sent", label: "MOU sent to applicant", variant: "default" },
    { to: "under_review", label: "Back to review", variant: "outline" },
  ],
  mou_sent: [{ to: "approved", label: "Back to approved", variant: "outline" }],
  mou_signed: [{ to: "mou_sent", label: "Reopen (MOU sent)", variant: "outline" }],
  rejected: [{ to: "under_review", label: "Reopen for review", variant: "outline" }],
  withdrawn: [{ to: "under_review", label: "Reopen for review", variant: "outline" }],
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function proposedText(r: { proposed_year: number | null; proposed_date: string | null; proposed_end_date: string | null }): string {
  if (r.proposed_year) return String(r.proposed_year)
  if (!r.proposed_date) return "—"
  return r.proposed_end_date ? `${formatDate(r.proposed_date)} – ${formatDate(r.proposed_end_date)}` : formatDate(r.proposed_date)
}

function StatusDot({ status }: { status: MouStatus }) {
  const meta = MOU_STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span className={cn("h-2 w-2 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  )
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-sm whitespace-pre-wrap", mono && "font-mono text-xs")}>{value ?? "—"}</p>
    </div>
  )
}

function MouApplicationsContent() {
  const searchParams = useSearchParams()
  const refFromUrl = searchParams.get("ref")

  const [rows, setRows] = useState<ListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("open")
  const [eventFilter, setEventFilter] = useState<MouEventType | "all">("all")
  const [filter, setFilter] = useState(refFromUrl ?? "")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const qs = new URLSearchParams({ status: statusFilter === "all" ? "" : statusFilter })
      if (eventFilter !== "all") qs.set("event", eventFilter)
      const res = await fetch(`/api/admin/mou-applications?${qs.toString()}`)
      if (res.status === 401 || res.status === 403) {
        setAuthorized(false)
        return
      }
      const data = await res.json()
      if (data?.status) setRows(data.data ?? [])
      else toast.error(data?.message || "Failed to load applications")
    } catch {
      toast.error("Failed to load applications")
    } finally {
      setLoading(false)
    }
  }, [statusFilter, eventFilter])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  // Deep link from the notification email: ?ref=MOU-2026-XXXX opens that row.
  useEffect(() => {
    if (!refFromUrl || loading) return
    const hit = rows.find((r) => r.reference_number === refFromUrl)
    if (hit) setSelectedId(hit.id)
    else if (statusFilter === "open") setStatusFilter("all")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refFromUrl, loading, rows])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) =>
      [r.reference_number, r.applicant_name, r.applicant_email, r.place, r.venue_name, String(r.amasi_number ?? "")]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q))
    )
  }, [rows, filter])

  if (!authorized) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-md border bg-muted">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="mb-2 text-xl font-bold">Access denied</h2>
        <p className="text-muted-foreground">Admin session required.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Academic events</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Event MOU applications</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Member applications to host AMASICON, workshops, rural camps and AMASI courses. Review, record the EC or GBM
          decision, and upload the counter-signed MOU to mark the event sanctioned.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="status" className="mb-1 block text-xs font-medium text-muted-foreground">
            Status
          </label>
          <select
            id="status"
            className="input-focus-ring flex h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="open">Open (submitted + under review)</option>
            <option value="all">All</option>
            {MOU_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MOU_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="event" className="mb-1 block text-xs font-medium text-muted-foreground">
            Event
          </label>
          <select
            id="event"
            className="input-focus-ring flex h-10 rounded-md border border-input bg-background px-3 text-sm"
            value={eventFilter}
            onChange={(e) => setEventFilter(e.target.value as MouEventType | "all")}
          >
            <option value="all">All events</option>
            {MOU_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {MOU_EVENTS[t].shortName}
              </option>
            ))}
          </select>
        </div>
        <div className="min-w-[220px] flex-1">
          <label htmlFor="filter" className="mb-1 block text-xs font-medium text-muted-foreground">
            Filter
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="filter" placeholder="reference, name, email, place, AMASI no." value={filter} onChange={(e) => setFilter(e.target.value)} className="pl-9" />
          </div>
        </div>
        <Button variant="outline" onClick={fetchRows} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
      </div>

      <div className="overflow-hidden rounded-md border bg-card">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
            <p className="mt-2 text-sm text-muted-foreground">Loading applications…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md border bg-muted">
              <FileSignature className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No applications match</p>
            <p className="mt-1 text-xs text-muted-foreground">Try a different status or event filter.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/60">
                  {["Received", "Reference", "Event", "Applicant", "Place", "Proposed", "Status", "Docs", ""].map((h) => (
                    <th key={h} scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-muted/30">
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{r.reference_number}</td>
                    <td className="whitespace-nowrap px-4 py-3">{MOU_EVENTS[r.event_type].shortName}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.applicant_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.amasi_number ? `AMASI ${r.amasi_number} · ` : ""}
                        {r.applicant_email}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      {r.place}
                      {r.state ? <span className="text-muted-foreground">, {r.state}</span> : null}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{proposedText(r)}</td>
                    <td className="px-4 py-3">
                      <StatusDot status={r.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.attachment_count}
                      {r.has_signed_mou ? " · MOU" : ""}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => setSelectedId(r.id)}>
                        Review
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ReviewDialog
        id={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={() => {
          fetchRows()
        }}
      />
    </div>
  )
}

function ReviewDialog({ id, onClose, onChanged }: { id: string | null; onClose: () => void; onChanged: () => void }) {
  const [row, setRow] = useState<DetailRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [notes, setNotes] = useState("")
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [uploadingMou, setUploadingMou] = useState(false)

  const load = useCallback(async (appId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/mou-applications/${appId}`)
      const data = await res.json()
      if (res.ok && data?.status) {
        setRow(data.application)
        setNotes(data.application.admin_notes ?? "")
        setReason(data.application.decision_reason ?? "")
      } else {
        toast.error(data?.message || "Failed to load application")
      }
    } catch {
      toast.error("Failed to load application")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (id) load(id)
    else setRow(null)
  }, [id, load])

  const patch = async (body: Record<string, unknown>, successMessage: string) => {
    if (!id) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/mou-applications/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (res.ok && data?.status) {
        toast.success(successMessage)
        await load(id)
        onChanged()
      } else {
        toast.error(data?.message || "Update failed")
      }
    } catch {
      toast.error("Update failed")
    } finally {
      setSaving(false)
    }
  }

  const uploadSignedMou = async (file: File) => {
    if (!id) return
    setUploadingMou(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch(`/api/admin/mou-applications/${id}/signed-mou`, { method: "POST", body: fd })
      const data = await res.json()
      if (res.ok && data?.status) {
        toast.success(data.status_now === "mou_signed" ? "Signed MOU stored — event sanctioned" : "Signed MOU stored")
        await load(id)
        onChanged()
      } else {
        toast.error(data?.message || "Upload failed")
      }
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploadingMou(false)
    }
  }

  const event = row ? MOU_EVENTS[row.event_type] : null
  const venueLabel = row?.venue_type ? MOU_VENUE_TYPES.find((v) => v.value === row.venue_type)?.label : null

  return (
    <Dialog open={!!id} onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-hidden p-0 sm:rounded-lg">
        <div className="flex max-h-[92vh] flex-col">
          <DialogHeader className="border-b px-6 py-4 text-left">
            <DialogTitle className="flex flex-wrap items-center gap-3">
              {row ? (
                <>
                  <span className="font-mono text-base">{row.reference_number}</span>
                  <StatusDot status={row.status} />
                </>
              ) : (
                "Application"
              )}
            </DialogTitle>
            <DialogDescription>{event ? event.name : "Loading…"}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-5">
            {loading || !row || !event ? (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-8">
                <section className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Applicant</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name" value={row.applicant_name} />
                    <Field label="AMASI number · member since" value={`${row.amasi_number ?? "—"} · ${formatDate(row.member_since)}`} />
                    <Field label="Email" value={row.applicant_email} />
                    <Field label="Phone" value={row.applicant_phone} />
                    <div className="sm:col-span-2">
                      <Field label="Address" value={row.applicant_address} />
                    </div>
                  </div>
                </section>

                <section className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Event</p>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {row.event_title && (
                      <div className="sm:col-span-2">
                        <Field label="Title" value={row.event_title} />
                      </div>
                    )}
                    <Field label="Proposed" value={proposedText(row)} />
                    <Field label="Place" value={[row.place, row.state].filter(Boolean).join(", ")} />
                    <Field label="Venue" value={row.venue_name} />
                    <Field label="Venue type" value={venueLabel} />
                    <Field label="Joint with another association" value={row.joint_with_association ? row.partner_association || "Yes" : "No"} />
                    <Field
                      label="Supporting associations"
                      value={
                        [row.supporting_city_chapter, row.supporting_state_chapter, row.supporting_others].filter(Boolean).join("; ") || "—"
                      }
                    />
                    {event.fields.map((f) => {
                      const v = row.details?.[f.key]
                      const display = f.kind === "select" ? f.options?.find((o) => o.value === v)?.label ?? v : v
                      return (
                        <div key={f.key} className={f.span === "full" || f.kind === "textarea" ? "sm:col-span-2" : undefined}>
                          <Field label={f.label} value={display == null || display === "" ? "—" : String(display)} />
                        </div>
                      )
                    })}
                    {row.remarks && (
                      <div className="sm:col-span-2">
                        <Field label="Remarks from applicant" value={row.remarks} />
                      </div>
                    )}
                  </div>
                </section>

                <section className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Documents</p>
                  {row.attachments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No documents attached.</p>
                  ) : (
                    <ul className="divide-y rounded-md border">
                      {row.attachments.map((a) => (
                        <li key={a.key + a.filename} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{MOU_ATTACHMENT_LABELS[a.key]}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {a.filename} · {(a.size / 1024).toFixed(0)} KB
                            </span>
                          </span>
                          {a.url ? (
                            <a href={a.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline">
                              Open <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">unavailable</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="text-xs text-muted-foreground">
                    Declarations accepted: {Object.keys(row.declarations ?? {}).length} of {event.declarations.length}
                  </div>
                </section>

                <section className="space-y-3">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Signed MOU</p>
                  {row.signed_mou_url ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border px-4 py-2.5 text-sm">
                      <span>
                        Counter-signed MOU on file
                        <span className="block text-xs text-muted-foreground">Received {formatDateTime(row.signed_mou_at)}</span>
                      </span>
                      <a href={row.signed_mou_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
                        Open <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Not received yet. Upload the PDF returned by the Organizing Secretary to sanction the event.</p>
                  )}
                  <label
                    className={cn(
                      "flex w-fit cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-accent",
                      uploadingMou && "pointer-events-none opacity-60"
                    )}
                  >
                    {uploadingMou ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {row.signed_mou_url ? "Replace signed MOU (PDF)" : "Upload signed MOU (PDF)"}
                    <input
                      type="file"
                      accept="application/pdf"
                      className="sr-only"
                      disabled={uploadingMou}
                      onChange={(e) => {
                        const f = e.target.files?.[0]
                        if (f) uploadSignedMou(f)
                        e.target.value = ""
                      }}
                    />
                  </label>
                </section>

                <section className="space-y-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">Review</p>
                  <div>
                    <Label htmlFor="admin_notes">Internal notes (not shown to applicant)</Label>
                    <Textarea id="admin_notes" className="mt-2" rows={3} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="decision_reason">Note to applicant (sent with approval / rejection emails)</Label>
                    <Textarea id="decision_reason" className="mt-2" rows={3} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} />
                  </div>
                  {row.reviewed_by && (
                    <p className="text-xs text-muted-foreground">
                      Last decision by {row.reviewed_by} on {formatDateTime(row.reviewed_at)}
                    </p>
                  )}
                </section>
              </div>
            )}
          </div>

          {row && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
              <Button
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => patch({ admin_notes: notes, decision_reason: reason }, "Notes saved")}
              >
                Save notes
              </Button>
              <div className="flex flex-wrap gap-2">
                {NEXT_ACTIONS[row.status].map((a) => (
                  <Button
                    key={a.to}
                    size="sm"
                    variant={a.variant ?? "outline"}
                    disabled={saving || (a.to === "rejected" && !reason.trim())}
                    title={a.to === "rejected" && !reason.trim() ? "Write a note to the applicant first" : undefined}
                    onClick={() =>
                      patch(
                        { status: a.to, admin_notes: notes, decision_reason: reason },
                        `Marked ${MOU_STATUS_META[a.to].label}`
                      )
                    }
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    {a.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function MouApplicationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      }
    >
      <MouApplicationsContent />
    </Suspense>
  )
}
