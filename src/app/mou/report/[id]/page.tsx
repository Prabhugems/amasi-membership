"use client"

import { useCallback, useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import Link from "next/link"
import { ArrowLeft, Loader2, AlertCircle, Upload, X, CheckCircle2, FileText, Image as ImageIcon } from "lucide-react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import type { ApplicationStatus, ApplicationTypeId } from "@/lib/mou/types"

// Route param, not useSearchParams/usePathname/useRouter — same
// AGENTS.md build-check-rules exemption already relied on by
// src/app/mou/status/[id]/page.tsx and src/app/mou/review/[token]/page.tsx.
interface ReportDoc {
  name: string
  fileUrl: string
}

interface ReportApplication {
  id: string
  application_type_id: ApplicationTypeId
  status: ApplicationStatus
  organizer_name: string
  event_name: string | null
  finalized_date: string | null
  preferred_date_1: string | null
  report_documents: ReportDoc[]
  report_notes: string | null
  report_submitted_at: string | null
}

function formatDate(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

async function uploadFile(applicationId: string, file: File, docType: "report" | "photo"): Promise<string> {
  const fd = new FormData()
  fd.append("file", file)
  fd.append("docType", docType)
  const res = await fetch(`/api/mou/applications/${applicationId}/report/upload`, { method: "POST", body: fd })
  const data = await res.json()
  if (!data.status) throw new Error(data.message || "Upload failed")
  return data.url as string
}

export default function MouReportPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [application, setApplication] = useState<ReportApplication | null>(null)

  const [reportDoc, setReportDoc] = useState<ReportDoc | null>(null)
  const [photos, setPhotos] = useState<ReportDoc[]>([])
  const [notes, setNotes] = useState("")
  const [uploadingReport, setUploadingReport] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/mou/applications/${id}`)
      const data = await res.json()
      if (!data.status) {
        setNotFound(true)
        return
      }
      setApplication(data.application)
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await load()
    })()
    return () => {
      cancelled = true
    }
  }, [id, load])

  const handleReportUpload = useCallback(
    async (file: File) => {
      setUploadingReport(true)
      try {
        const fileUrl = await uploadFile(id, file, "report")
        setReportDoc({ name: file.name, fileUrl })
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setUploadingReport(false)
      }
    },
    [id]
  )

  const handlePhotoUpload = useCallback(
    async (file: File) => {
      setUploadingPhoto(true)
      try {
        const fileUrl = await uploadFile(id, file, "photo")
        setPhotos((prev) => [...prev, { name: file.name, fileUrl }])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed")
      } finally {
        setUploadingPhoto(false)
      }
    },
    [id]
  )

  const handleSubmit = useCallback(async () => {
    const documents = [...(reportDoc ? [reportDoc] : []), ...photos]
    if (documents.length === 0) {
      toast.error("Upload at least the report document, or a photo, before submitting")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch(`/api/mou/applications/${id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documents, notes: notes.trim() || undefined }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Failed to submit report")
        return
      }
      toast.success("Report submitted — thank you")
      await load()
    } catch {
      toast.error("Failed to submit report. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }, [id, reportDoc, photos, notes, load])

  const typeLabel = application ? getEventTypeConfig(application.application_type_id)?.label ?? application.application_type_id : ""
  const canReport = application && (application.status === "approved" || application.status === "completed")
  const alreadySubmitted = !!application?.report_submitted_at

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href={id ? `/mou/status/${id}` : "/mou"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to application status
        </Link>

        <div className="mt-4 mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Post-event report</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Submit your event report</h1>
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

        {!loading && application && !canReport && (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted">
                <AlertCircle className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                This application isn&apos;t approved, so there&apos;s no event to report on.
              </p>
            </CardContent>
          </Card>
        )}

        {!loading && application && canReport && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-semibold">{application.event_name || typeLabel}</CardTitle>
                <CardDescription>{typeLabel} — {application.organizer_name}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between border-b border-border pb-2">
                  <span className="text-muted-foreground">Event date</span>
                  <span className="text-foreground">{formatDate(application.finalized_date || application.preferred_date_1)}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Per the MOU: a comprehensive report with photographs is due within 15 days of the event.
                </p>
              </CardContent>
            </Card>

            {alreadySubmitted ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-success" />
                    Report submitted
                  </CardTitle>
                  <CardDescription>Submitted on {formatDate(application.report_submitted_at)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {application.report_documents.map((d, i) => (
                    <a
                      key={i}
                      href={d.fileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-muted/30"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {d.name}
                    </a>
                  ))}
                  {application.report_notes && (
                    <div className="mt-3 rounded-md border border-border bg-muted/30 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Notes</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{application.report_notes}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Upload your report</CardTitle>
                  <CardDescription>Report document (PDF) and event photographs, JPG/PNG/PDF, max 5MB each.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-foreground mb-1">Report document</p>
                    {reportDoc ? (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                        <span className="flex items-center gap-1.5 text-foreground truncate">
                          <FileText className="h-4 w-4 shrink-0 text-success" />
                          {reportDoc.name}
                        </span>
                        <button type="button" onClick={() => setReportDoc(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground hover:border-primary/50">
                        {uploadingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {uploadingReport ? "Uploading…" : "Click to upload report document"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          className="hidden"
                          disabled={uploadingReport}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handleReportUpload(file)
                            e.target.value = ""
                          }}
                        />
                      </label>
                    )}
                  </div>

                  <div>
                    <p className="text-xs font-medium text-foreground mb-1">Photographs</p>
                    <div className="space-y-2">
                      {photos.map((p, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                          <span className="flex items-center gap-1.5 text-foreground truncate">
                            <ImageIcon className="h-4 w-4 shrink-0 text-success" />
                            {p.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                            className="text-muted-foreground hover:text-foreground shrink-0"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                      <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground hover:border-primary/50">
                        {uploadingPhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {uploadingPhoto ? "Uploading…" : "Add a photograph"}
                        <input
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          disabled={uploadingPhoto}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) handlePhotoUpload(file)
                            e.target.value = ""
                          }}
                        />
                      </label>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-foreground mb-1">Notes (optional)</p>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Anything else worth noting about the event"
                      rows={4}
                    />
                  </div>

                  <Button type="button" onClick={handleSubmit} disabled={submitting || uploadingReport || uploadingPhoto} className="w-full">
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Submit report"}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
