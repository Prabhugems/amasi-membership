"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { Loader2, AlertCircle, MessageSquare, CheckCircle2, XCircle, RotateCcw, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/mou/status-badge"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
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

function detailRow(label: string, value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined || value === "") return null
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : String(value)
  return (
    <div key={label} className="flex justify-between gap-4 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right text-foreground">{display}</span>
    </div>
  )
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
                <CardDescription>
                  {getEventTypeConfig(application.application_type_id)?.label}
                  {role && ` — viewing as ${role.replace(/_/g, " ")}`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {detailRow("Organizer", application.organizer_name)}
                {detailRow("Email", application.email)}
                {detailRow("Phone", application.phone_number)}
                {detailRow("Institution", application.primary_institution)}
                {detailRow("AMASI membership number", application.applicant_amasi_number)}
                {detailRow("Preferred date", application.preferred_date_1)}
                {detailRow("Alternate date", application.preferred_date_2)}
                {detailRow("Zone", application.zone)}
                {detailRow("Expected participants", application.expected_participants)}
                {detailRow("Live surgery demo", application.live_surgery_demo)}
                {detailRow("Venue type", application.venue_type)}
                {detailRow("Venue name", application.venue_name)}
                {detailRow("Venue address", application.venue_address)}
                {detailRow("Venue city", application.venue_city)}
                {detailRow("Venue state", application.venue_state)}
                {detailRow("Venue ZIP", application.venue_zip)}
                {detailRow("Venue country", application.venue_country)}
                {detailRow("Hall A", application.auditorium_hall_a)}
                {detailRow("Hall B", application.auditorium_hall_b)}
                {detailRow("AV equipment", application.av_equipment)}
                {detailRow("Endotrainers", application.endotrainers)}
                {detailRow("High-speed internet", application.high_speed_internet)}
                {detailRow("Submitted", formatDate(application.created_at))}
                {detailRow("Last reviewed", formatDate(application.reviewed_at))}
                {application.committee_member_photo_url && (
                  <div className="border-b border-border py-2 text-sm">
                    <span className="text-muted-foreground">Committee member photo</span>
                    <a href={application.committee_member_photo_url} target="_blank" rel="noopener noreferrer" className="block mt-1 text-primary underline underline-offset-2">
                      View photo
                    </a>
                  </div>
                )}
                {application.institution_photo_url && (
                  <div className="py-2 text-sm">
                    <span className="text-muted-foreground">Institution photo</span>
                    <a href={application.institution_photo_url} target="_blank" rel="noopener noreferrer" className="block mt-1 text-primary underline underline-offset-2">
                      View photo
                    </a>
                  </div>
                )}
                {application.rejection_reason && (
                  <div className="mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Reviewer notes</p>
                    <p className="text-foreground">{application.rejection_reason}</p>
                  </div>
                )}
              </CardContent>
            </Card>

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
