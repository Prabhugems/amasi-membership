"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Loader2, AlertCircle, MessageSquare } from "lucide-react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusBadge } from "@/components/mou/status-badge"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import type { ApplicationStatus, ApplicationTypeId } from "@/lib/mou/types"

// Route param, not useSearchParams/usePathname/useRouter — `useParams` reads
// the matched dynamic segment from the App Router's route context, it does
// not opt the page out of static prerendering the way the client-router
// hooks named in AGENTS.md's build-check-rules do. No <Suspense> needed;
// confirmed by a clean `next build` (see task report).
interface StatusApplication {
  id: string
  application_type_id: ApplicationTypeId
  status: ApplicationStatus
  organizer_name: string
  event_name: string | null
  created_at: string
  reviewed_at: string | null
  rejection_reason: string | null
}

interface Remark {
  author_name: string
  author_role: string
  body: string
  created_at: string
}

function formatDate(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export default function MouStatusPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [application, setApplication] = useState<StatusApplication | null>(null)
  const [remarks, setRemarks] = useState<Remark[]>([])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/mou/applications/${id}`)
        const data = await res.json()
        if (cancelled) return
        if (!data.status) {
          setNotFound(true)
          return
        }
        setApplication(data.application)
        setRemarks(data.remarks ?? [])
      } catch {
        if (!cancelled) setNotFound(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [id])

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/mou" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to applications
        </Link>

        <div className="mt-4 mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Application status</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Track your application</h1>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        )}

        {!loading && notFound && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t find this application. Double-check the link, or contact membership@amasi.org.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && application && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-semibold">
                    {application.event_name || getEventTypeConfig(application.application_type_id)?.label || application.application_type_id}
                  </CardTitle>
                  <StatusBadge status={application.status} />
                </div>
                <CardDescription>
                  {getEventTypeConfig(application.application_type_id)?.label} — submitted by {application.organizer_name}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Submitted</span>
                  <span className="text-foreground">{formatDate(application.created_at)}</span>
                </div>
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Last reviewed</span>
                  <span className="text-foreground">{formatDate(application.reviewed_at)}</span>
                </div>
                {application.rejection_reason && (
                  <div className="rounded-md border border-border bg-muted/30 p-3">
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
                <CardDescription>Read-only — reviewers can post remarks from their approval link.</CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}
