"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import {
  Loader2, AlertCircle, MessageSquare, CheckCircle2, XCircle, RotateCcw, Send,
  User, CalendarDays, MapPin, Image as ImageIcon, Clock, ListChecks, Download,
  AlertTriangle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/mou/status-badge"
import {
  getEventTypeConfig,
  isMouEventTypeConfig,
  SHARED_TYPE_SPECIFIC_COLUMN_KEYS,
  type TypeSpecificFieldDef,
} from "@/lib/mou/event-type-config"
import { isSafeHttpUrl } from "@/lib/mou/safe-url"
import type { AcademicEventApplication } from "@/lib/mou/types"

// `token` comes from the route param via useParams — not useSearchParams /
// usePathname / useRouter — so per AGENTS.md's build-check-rules this does
// not force the page out of static prerendering. This page is already
// "use client" (it has interactive Approve/Reject/Request Changes buttons),
// so no <Suspense> boundary is required either way; confirmed with a clean
// `next build` (see task report).
interface Remark {
  author_name: string
  author_role: string
  body: string
  created_at: string
}

type DecisionAction = "approved" | "rejected" | "changes_requested"

const DECISION_LABELS: Record<DecisionAction, string> = {
  approved: "Approved",
  rejected: "Rejected",
  changes_requested: "Changes requested",
}

function formatDate(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

function detail(label: string, value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return null
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
  return (
    <div key={label}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm text-foreground">{display}</p>
    </div>
  )
}

function SectionHeading({ icon: Icon, children }: { icon: typeof User; children: ReactNode }) {
  return (
    <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
      <Icon className="h-4 w-4 text-muted-foreground" />
      {children}
    </CardTitle>
  )
}

// Mirrors the identical helper in src/app/admin/mou-applications/page.tsx —
// a typeSpecificFields key either has a real column on the application row
// (SHARED_TYPE_SPECIFIC_COLUMN_KEYS) or lives only in type_specific_data.
// The migration adding type_specific_data (sql/040) may not have run on
// every environment, so fall back to {} rather than dereferencing directly.
function typeSpecificValue(
  application: AcademicEventApplication,
  typeSpecificData: Record<string, unknown>,
  field: TypeSpecificFieldDef
): string | null {
  if (field.kind === "facilities-group") {
    const group = (typeSpecificData.facilities ?? {}) as Record<string, unknown>
    return field.items
      .filter((i) => group[i.key])
      .map((i) => (i.kind === "checkbox" ? i.label : `${i.label}: ${group[i.key]}`))
      .join(" · ") || null
  }
  const value = SHARED_TYPE_SPECIFIC_COLUMN_KEYS.has(field.key)
    ? (application as unknown as Record<string, unknown>)[field.key]
    : typeSpecificData[field.key]
  if (value === undefined || value === null || value === "") return null
  return typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
}

export default function MouReviewPage() {
  const params = useParams<{ token: string }>()
  const token = params.token

  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [application, setApplication] = useState<AcademicEventApplication | null>(null)
  const [remarks, setRemarks] = useState<Remark[]>([])
  const [canDecide, setCanDecide] = useState(false)
  const [role, setRole] = useState<string>("")
  // Set once a decision POST succeeds. The token is burned by that same
  // request, so re-fetching afterward (GET /api/mou/review/[token]) would
  // correctly — but confusingly — come back as "This link has already been
  // used to make a decision." Once this is set, the page renders a terminal
  // success view instead of reloading/re-verifying the token.
  const [decidedAction, setDecidedAction] = useState<DecisionAction | null>(null)
  const [decidedAt, setDecidedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return
    setLoading(true)
    try {
      const res = await fetch(`/api/mou/review/${token}`)
      const data = await res.json()
      if (!data.status) {
        setLoadError(data.message || "This link is invalid or has expired.")
        return
      }
      setApplication(data.application)
      setRemarks(data.remarks ?? [])
      setCanDecide(!!data.canDecide)
      setRole(data.role ?? "")
      setLoadError(null)
    } catch {
      setLoadError("Could not load this application. Please try again.")
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  // Remarks
  const [remarkBody, setRemarkBody] = useState("")
  const [postingRemark, setPostingRemark] = useState(false)

  const postRemark = useCallback(async () => {
    if (!remarkBody.trim() || !application) return
    setPostingRemark(true)
    try {
      const res = await fetch(`/api/mou/applications/${application.id}/remarks?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: remarkBody.trim() }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Could not post remark")
        return
      }
      setRemarkBody("")
      toast.success("Remark posted")
      await load()
    } catch {
      toast.error("Could not post remark. Please try again.")
    } finally {
      setPostingRemark(false)
    }
  }, [remarkBody, application, token, load])

  // Decisions
  const [pendingAction, setPendingAction] = useState<DecisionAction | null>(null)
  const [decisionNotes, setDecisionNotes] = useState("")
  const [deciding, setDeciding] = useState(false)

  const submitDecision = useCallback(
    async (action: DecisionAction) => {
      if ((action === "rejected" || action === "changes_requested") && !decisionNotes.trim()) {
        toast.error("Please add a reason before submitting this decision")
        return
      }
      setDeciding(true)
      try {
        const res = await fetch(`/api/mou/review/${token}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, notes: decisionNotes.trim() || undefined }),
        })
        const data = await res.json()
        if (!data.status) {
          toast.error(data.message || "Could not save the decision")
          return
        }
        toast.success("Decision saved")
        setPendingAction(null)
        setDecisionNotes("")
        // Do NOT reload/re-verify the token here — the decide POST that just
        // succeeded burned it, so a subsequent GET would correctly report
        // "already used" and render as an error state right after a success
        // toast. Show a terminal success view instead.
        setDecidedAction(action)
        setDecidedAt(new Date().toISOString())
      } catch {
        toast.error("Could not save the decision. Please try again.")
      } finally {
        setDeciding(false)
      }
    },
    [decisionNotes, token]
  )

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Event application review</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Review application</h1>
        </div>

        {decidedAction && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-semibold text-foreground">Decision recorded</p>
              <p className="text-sm text-muted-foreground">
                {DECISION_LABELS[decidedAction]}{decidedAt ? ` on ${formatDate(decidedAt)}` : ""}.
              </p>
              <p className="text-sm text-muted-foreground">
                This link has now been used and cannot be used again. You can close this page.
              </p>
            </CardContent>
          </Card>
        )}

        {!decidedAction && loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {!decidedAction && !loading && loadError && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{loadError}</p>
            </CardContent>
          </Card>
        )}

        {!decidedAction && !loading && application && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-semibold">
                    {application.event_name || getEventTypeConfig(application.application_type_id)?.label}
                  </CardTitle>
                  <StatusBadge status={application.status} />
                </div>
                <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{getEventTypeConfig(application.application_type_id)?.label}</span>
                  {application.zone && (
                    <span className="inline-flex items-center gap-1 text-xs">
                      <MapPin className="h-3 w-3" />
                      {application.zone} Zone
                    </span>
                  )}
                  {role && <span>Viewing as {role.replace(/_/g, " ")}</span>}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Submitted {formatDate(application.created_at)}
                </span>
                {application.reviewed_at && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Last reviewed {formatDate(application.reviewed_at)}
                  </span>
                )}
              </CardContent>
              {application.rejection_reason && (
                <CardContent className="pt-0">
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Reviewer notes</p>
                    <p className="text-foreground">{application.rejection_reason}</p>
                  </div>
                </CardContent>
              )}
            </Card>

            <Card>
              <CardHeader>
                <SectionHeading icon={User}>Applicant</SectionHeading>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {detail("Organizer", application.organizer_name)}
                  {detail("Institution", application.primary_institution)}
                  {detail("Email", application.email)}
                  {detail("Phone", application.phone_number)}
                  {detail("AMASI membership number", application.applicant_amasi_number)}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <SectionHeading icon={CalendarDays}>Event</SectionHeading>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {detail("Preferred date", application.preferred_date_1)}
                  {detail("Alternate date", application.preferred_date_2)}
                  {detail("Expected participants", application.expected_participants)}
                  {detail("Live surgery demo", application.live_surgery_demo)}
                </div>
              </CardContent>
            </Card>

            {(application.venue_type || application.venue_name || application.venue_address ||
              application.venue_city || application.venue_state || application.venue_zip ||
              application.auditorium_hall_a || application.auditorium_hall_b ||
              application.av_equipment || application.endotrainers || application.high_speed_internet) && (
              <Card>
                <CardHeader>
                  <SectionHeading icon={MapPin}>Venue</SectionHeading>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {detail("Venue type", application.venue_type)}
                    {detail("Venue name", application.venue_name)}
                    {detail("Address", application.venue_address)}
                    {detail("City", application.venue_city)}
                    {detail("State", application.venue_state)}
                    {detail("Postal code", application.venue_zip)}
                    {detail("Country", application.venue_country)}
                    {detail("Hall A", application.auditorium_hall_a)}
                    {detail("Hall B", application.auditorium_hall_b)}
                    {detail("AV equipment", application.av_equipment)}
                    {detail("Endotrainers", application.endotrainers)}
                    {detail("High-speed internet", application.high_speed_internet)}
                  </div>
                </CardContent>
              </Card>
            )}

            {(() => {
              const typeConfig = getEventTypeConfig(application.application_type_id)
              if (!typeConfig || !isMouEventTypeConfig(typeConfig)) return null
              const typeSpecificData = (application.type_specific_data ?? {}) as Record<string, unknown>
              const scalarFields = typeConfig.typeSpecificFields.filter(
                (f) => f.kind !== "faculty-rows" && f.kind !== "association-rows" && f.kind !== "conditional-upload"
              )
              const uploadFields = typeConfig.typeSpecificFields.filter(
                (f): f is Extract<TypeSpecificFieldDef, { kind: "conditional-upload" }> => f.kind === "conditional-upload"
              )
              const financialAssistanceRequested =
                application.application_type_id === "rural_program" && typeSpecificData.financial_assistance_requested === true
              const smallStateExceptionRequested =
                application.application_type_id === "workshop" && typeSpecificData.small_state_exception_requested === true

              return (
                <Card>
                  <CardHeader>
                    <SectionHeading icon={ListChecks}>{typeConfig.label} details</SectionHeading>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {scalarFields.map((f) => {
                        const value = typeSpecificValue(application, typeSpecificData, f)
                        return value ? detail(f.kind === "facilities-group" ? "Facilities" : f.label, value) : null
                      })}
                    </div>

                    {application.faculty && application.faculty.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Faculty</p>
                        <div className="space-y-1.5">
                          {application.faculty.map((f, i) => (
                            <div key={i} className="rounded-md border border-border p-2 text-sm">
                              <span className="font-medium text-foreground">{f.name}</span>
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

                    {application.partner_associations && application.partner_associations.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">Partner associations</p>
                        <div className="space-y-1.5">
                          {application.partner_associations.map((a, i) => (
                            <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm">
                              <span className="font-medium text-foreground">{a.name}</span>
                              {isSafeHttpUrl(a.consent_letter_url) && (
                                <a
                                  href={a.consent_letter_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex shrink-0 items-center gap-1 text-xs text-primary hover:underline"
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

                    {uploadFields.map((f) => {
                      const url = (application as unknown as Record<string, unknown>)[`${f.docType}_url`]
                      if (!isSafeHttpUrl(url)) return null
                      return (
                        <div key={f.key}>
                          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{f.label}</p>
                          <Button asChild variant="outline" size="sm" className="gap-1.5">
                            <a href={url} target="_blank" rel="noopener noreferrer">
                              <Download className="h-3.5 w-3.5" />
                              Open document
                            </a>
                          </Button>
                        </div>
                      )
                    })}

                    {financialAssistanceRequested && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        Financial assistance requested (up to ₹1,00,000).
                      </div>
                    )}
                    {smallStateExceptionRequested && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        Small-state faculty transport requested (clause 17) — this costs AMASI money. State: {String(typeSpecificData.venue_state ?? application.venue_state ?? "—")}, faculty count: {String(typeSpecificData.small_state_faculty_count ?? "—")}.
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })()}

            {(application.committee_member_photo_url || application.institution_photo_url) && (
              <Card>
                <CardHeader>
                  <SectionHeading icon={ImageIcon}>Documents</SectionHeading>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {application.committee_member_photo_url && (
                      <div>
                        <p className="text-xs text-muted-foreground">Committee member photo</p>
                        <a href={application.committee_member_photo_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-sm text-primary underline underline-offset-2">
                          View photo
                        </a>
                      </div>
                    )}
                    {application.institution_photo_url && (
                      <div>
                        <p className="text-xs text-muted-foreground">Institution photo</p>
                        <a href={application.institution_photo_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block text-sm text-primary underline underline-offset-2">
                          View photo
                        </a>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                  <MessageSquare className="h-4 w-4" />
                  Remarks
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {remarks.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No remarks yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {remarks.map((r, i) => (
                      <li key={i} className="rounded-md border border-border p-3 text-sm">
                        <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                          <span className="font-medium text-foreground">{r.author_name}</span>
                          <span>{formatDate(r.created_at)}</span>
                        </div>
                        <p className="text-foreground">{r.body}</p>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="space-y-2">
                  <Textarea
                    value={remarkBody}
                    onChange={(e) => setRemarkBody(e.target.value)}
                    placeholder="Add a remark for the applicant or other reviewers…"
                    rows={3}
                  />
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="outline" onClick={postRemark} disabled={postingRemark || !remarkBody.trim()}>
                      {postingRemark ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Post remark
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {canDecide && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Decision</CardTitle>
                  <CardDescription>This is a one-time decision — it cannot be changed once submitted.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {(pendingAction === "rejected" || pendingAction === "changes_requested") && (
                    <div className="space-y-2">
                      <Textarea
                        value={decisionNotes}
                        onChange={(e) => setDecisionNotes(e.target.value)}
                        placeholder={pendingAction === "rejected" ? "Reason for rejection (required)" : "What needs to change (required)"}
                        rows={3}
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="success"
                      disabled={deciding}
                      onClick={() => (pendingAction === "approved" ? submitDecision("approved") : setPendingAction("approved"))}
                    >
                      {deciding && pendingAction === "approved" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      {pendingAction === "approved" ? "Confirm approve" : "Approve"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={deciding}
                      onClick={() => (pendingAction === "changes_requested" ? submitDecision("changes_requested") : setPendingAction("changes_requested"))}
                    >
                      {deciding && pendingAction === "changes_requested" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      {pendingAction === "changes_requested" ? "Confirm request" : "Request changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={deciding}
                      onClick={() => (pendingAction === "rejected" ? submitDecision("rejected") : setPendingAction("rejected"))}
                    >
                      {deciding && pendingAction === "rejected" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                      {pendingAction === "rejected" ? "Confirm reject" : "Reject"}
                    </Button>
                    {pendingAction && (
                      <Button type="button" variant="ghost" disabled={deciding} onClick={() => { setPendingAction(null); setDecisionNotes("") }}>
                        Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
