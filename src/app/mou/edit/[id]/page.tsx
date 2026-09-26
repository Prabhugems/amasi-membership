"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Loader2, AlertCircle, Plus, Trash2 } from "lucide-react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/mou/status-badge"
import type { ApplicationStatus, ApplicationTypeId } from "@/lib/mou/types"

// Route param via useParams, not useSearchParams/usePathname/useRouter —
// same reasoning as status/[id]/page.tsx and report/[id]/page.tsx (avoids
// the client-router-hook-without-Suspense build failure AGENTS.md's
// build-check-rules warns about). The edit token, unlike the route id, is
// a query string value — read directly from window.location.search inside
// an effect (plain browser API, not a Next.js router hook) rather than
// useSearchParams, for the same reason.
interface EditableApplication {
  id: string
  application_type_id: ApplicationTypeId
  typeLabel: string
  status: ApplicationStatus
  rejection_reason: string | null
  editable: boolean
  organizer_name: string
  applicant_amasi_number: string | null
  primary_institution: string
  event_name: string | null
  expected_participants: number | null
  preferred_date_1: string | null
  preferred_date_2: string | null
  venue_type: string | null
  venue_name: string | null
  venue_address: string | null
  venue_city: string | null
  venue_state: string | null
  venue_zip: string | null
  venue_country: string | null
  zone: string | null
  faculty: Array<{ name: string; is_amasi_member: boolean; speciality: string | null }> | null
}

interface FacultyRow {
  name: string
  is_amasi_member: boolean
  speciality: string
}

function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="mt-1" />
    </div>
  )
}

export default function MouEditPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  // The edit token, unlike route params, is a query-string value — read
  // once from window.location.search via a ref, not React state, so
  // reading it stays a plain mutation rather than a setState call inside
  // the mount effect below (see the effect's own comment for why that
  // distinction matters here).
  const tokenRef = useRef<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [needsAuth, setNeedsAuth] = useState(false)
  const [application, setApplication] = useState<EditableApplication | null>(null)

  const [form, setForm] = useState<Record<string, string>>({})
  const [faculty, setFaculty] = useState<FacultyRow[]>([])

  // OTP fallback — used when there's no (or an invalid/expired) edit
  // token, mirroring src/app/mou/[type]/page.tsx's inline OTP flow.
  const [otpEmail, setOtpEmail] = useState("")
  const [otpCode, setOtpCode] = useState("")
  const [otpStep, setOtpStep] = useState<"idle" | "sent" | "verified">("idle")
  const [otpSending, setOtpSending] = useState(false)
  const [otpVerifying, setOtpVerifying] = useState(false)
  const [verifiedEmail, setVerifiedEmail] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)

  const loadApplication = useCallback(
    async (credential: { token?: string; email?: string }) => {
      if (!id) return
      try {
        const qs = new URLSearchParams()
        if (credential.token) qs.set("token", credential.token)
        if (credential.email) qs.set("email", credential.email)
        const res = await fetch(`/api/mou/applications/${id}/edit?${qs.toString()}`)
        const data = await res.json()
        if (!data.status) {
          if (res.status === 404) {
            setNotFound(true)
          } else {
            setNeedsAuth(true)
          }
          return
        }
        setApplication(data.application)
        setNeedsAuth(false)
        setForm({
          organizer_name: data.application.organizer_name ?? "",
          applicant_amasi_number: data.application.applicant_amasi_number ?? "",
          primary_institution: data.application.primary_institution ?? "",
          event_name: data.application.event_name ?? "",
          expected_participants: data.application.expected_participants?.toString() ?? "",
          preferred_date_1: data.application.preferred_date_1 ?? "",
          preferred_date_2: data.application.preferred_date_2 ?? "",
          venue_type: data.application.venue_type ?? "",
          venue_name: data.application.venue_name ?? "",
          venue_address: data.application.venue_address ?? "",
          venue_city: data.application.venue_city ?? "",
          venue_state: data.application.venue_state ?? "",
          venue_zip: data.application.venue_zip ?? "",
          venue_country: data.application.venue_country ?? "",
          zone: data.application.zone ?? "",
        })
        setFaculty(
          (data.application.faculty ?? []).map((f: EditableApplication["faculty"] extends (infer R)[] | null ? R : never) => ({
            name: f.name ?? "",
            is_amasi_member: f.is_amasi_member ?? true,
            speciality: f.speciality ?? "",
          }))
        )
      } catch {
        setNeedsAuth(true)
      } finally {
        setLoading(false)
      }
    },
    [id]
  )

  useEffect(() => {
    if (!id) return
    let cancelled = false
    ;(async () => {
      const urlToken = new URLSearchParams(window.location.search).get("token")
      tokenRef.current = urlToken
      if (!urlToken) {
        if (!cancelled) {
          setLoading(false)
          setNeedsAuth(true)
        }
        return
      }
      await loadApplication({ token: urlToken })
    })()
    return () => {
      cancelled = true
    }
  }, [id, loadApplication])

  async function sendOtp() {
    if (!otpEmail) return
    setOtpSending(true)
    try {
      const res = await fetch("/api/mou/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otpEmail }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Could not send code")
        return
      }
      setOtpStep("sent")
      toast.success("Code sent — check your email")
    } catch {
      toast.error("Could not send code")
    } finally {
      setOtpSending(false)
    }
  }

  async function verifyOtp() {
    if (!otpCode) return
    setOtpVerifying(true)
    try {
      const res = await fetch("/api/mou/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: otpEmail, code: otpCode }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Invalid code")
        return
      }
      setOtpStep("verified")
      setVerifiedEmail(otpEmail)
      await loadApplication({ email: otpEmail })
    } catch {
      toast.error("Could not verify code")
    } finally {
      setOtpVerifying(false)
    }
  }

  async function handleSave() {
    if (!application) return
    setSaving(true)
    try {
      const updates: Record<string, unknown> = {
        organizer_name: form.organizer_name,
        applicant_amasi_number: form.applicant_amasi_number || null,
        primary_institution: form.primary_institution,
        event_name: form.event_name || null,
        expected_participants: form.expected_participants ? Number(form.expected_participants) : null,
        preferred_date_1: form.preferred_date_1 || null,
        preferred_date_2: form.preferred_date_2 || null,
        venue_type: form.venue_type || null,
        venue_name: form.venue_name || null,
        venue_address: form.venue_address || null,
        venue_city: form.venue_city || null,
        venue_state: form.venue_state || null,
        venue_zip: form.venue_zip || null,
        venue_country: form.venue_country || null,
        zone: form.zone || null,
      }
      if (application.faculty !== null) {
        updates.faculty = faculty
          .filter((f) => f.name.trim())
          .map((f) => ({ name: f.name.trim(), is_amasi_member: f.is_amasi_member, speciality: f.speciality.trim() || null }))
      }

      const res = await fetch(`/api/mou/applications/${application.id}/edit`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ editToken: tokenRef.current || undefined, email: verifiedEmail || undefined, updates }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Could not save changes")
        return
      }
      if (!data.changed) {
        toast("No changes to save")
        return
      }
      toast.success(data.resubmitted ? "Resubmitted — the Hon. Secretary has been notified" : "Changes saved")
      await loadApplication({ token: tokenRef.current || undefined, email: verifiedEmail || undefined })
    } catch {
      toast.error("Could not save changes")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href={id ? `/mou/status/${id}` : "/mou"} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to status
        </Link>

        <div className="mt-4 mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Edit application</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
            {application?.event_name || application?.typeLabel || "Edit your application"}
          </h1>
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

        {!loading && needsAuth && otpStep !== "verified" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Verify your email</CardTitle>
              <CardDescription>
                This link is missing or has expired. Enter the email you applied with to get a one-time code.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Email" value={otpEmail} onChange={setOtpEmail} type="email" />
              {otpStep === "idle" ? (
                <Button onClick={sendOtp} disabled={otpSending || !otpEmail} size="sm">
                  {otpSending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Send code
                </Button>
              ) : (
                <div className="space-y-2">
                  <Field label="Code" value={otpCode} onChange={setOtpCode} />
                  <Button onClick={verifyOtp} disabled={otpVerifying || !otpCode} size="sm">
                    {otpVerifying && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Verify
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {!loading && application && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-base font-semibold">{application.typeLabel}</CardTitle>
                  <StatusBadge status={application.status} />
                </div>
                {application.status === "changes_requested" && application.rejection_reason && (
                  <div className="mt-2 rounded-md border border-border bg-muted/30 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Changes requested
                    </p>
                    <p className="text-sm text-foreground">{application.rejection_reason}</p>
                  </div>
                )}
              </CardHeader>
            </Card>

            {!application.editable && (
              <Card>
                <CardContent className="py-6 text-sm text-muted-foreground">
                  This application can no longer be edited directly ({application.status}).{" "}
                  {(application.status === "approved" || application.status === "completed") && (
                    <>
                      Need a date, venue, or faculty change?{" "}
                      <Link href={`/mou/status/${application.id}`} className="text-primary underline">
                        Request a change
                      </Link>{" "}
                      from your status page.
                    </>
                  )}
                </CardContent>
              </Card>
            )}

            {application.editable && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Application details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Organizer name" value={form.organizer_name} onChange={(v) => setForm((f) => ({ ...f, organizer_name: v }))} />
                  <Field label="AMASI number" value={form.applicant_amasi_number} onChange={(v) => setForm((f) => ({ ...f, applicant_amasi_number: v }))} />
                  <Field label="Primary institution" value={form.primary_institution} onChange={(v) => setForm((f) => ({ ...f, primary_institution: v }))} />
                  <Field label="Event name" value={form.event_name} onChange={(v) => setForm((f) => ({ ...f, event_name: v }))} />
                  <Field label="Expected participants" value={form.expected_participants} onChange={(v) => setForm((f) => ({ ...f, expected_participants: v }))} type="number" />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Preferred date 1" value={form.preferred_date_1} onChange={(v) => setForm((f) => ({ ...f, preferred_date_1: v }))} type="date" />
                    <Field label="Preferred date 2" value={form.preferred_date_2} onChange={(v) => setForm((f) => ({ ...f, preferred_date_2: v }))} type="date" />
                  </div>
                </CardContent>
              </Card>
            )}

            {application.editable && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Venue</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <Field label="Venue type" value={form.venue_type} onChange={(v) => setForm((f) => ({ ...f, venue_type: v }))} />
                  <Field label="Venue name" value={form.venue_name} onChange={(v) => setForm((f) => ({ ...f, venue_name: v }))} />
                  <div>
                    <Label className="text-xs">Venue address</Label>
                    <Textarea
                      value={form.venue_address}
                      onChange={(e) => setForm((f) => ({ ...f, venue_address: e.target.value }))}
                      className="mt-1"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="City" value={form.venue_city} onChange={(v) => setForm((f) => ({ ...f, venue_city: v }))} />
                    <Field label="State" value={form.venue_state} onChange={(v) => setForm((f) => ({ ...f, venue_state: v }))} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="ZIP" value={form.venue_zip} onChange={(v) => setForm((f) => ({ ...f, venue_zip: v }))} />
                    <Field label="Country" value={form.venue_country} onChange={(v) => setForm((f) => ({ ...f, venue_country: v }))} />
                  </div>
                </CardContent>
              </Card>
            )}

            {application.editable && application.faculty !== null && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-semibold">Faculty</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {faculty.map((row, i) => (
                    <div key={i} className="flex items-end gap-2 rounded-md border border-border p-3">
                      <div className="flex-1 space-y-2">
                        <Field label="Name" value={row.name} onChange={(v) => setFaculty((rows) => rows.map((r, idx) => (idx === i ? { ...r, name: v } : r)))} />
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={row.is_amasi_member}
                            onChange={(e) => setFaculty((rows) => rows.map((r, idx) => (idx === i ? { ...r, is_amasi_member: e.target.checked } : r)))}
                            className="h-4 w-4 rounded border-input"
                          />
                          AMASI member
                        </label>
                        {!row.is_amasi_member && (
                          <Field
                            label="Speciality"
                            value={row.speciality}
                            onChange={(v) => setFaculty((rows) => rows.map((r, idx) => (idx === i ? { ...r, speciality: v } : r)))}
                          />
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="icon"
                        type="button"
                        onClick={() => setFaculty((rows) => rows.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    size="sm"
                    type="button"
                    onClick={() => setFaculty((rows) => [...rows, { name: "", is_amasi_member: true, speciality: "" }])}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add faculty
                  </Button>
                </CardContent>
              </Card>
            )}

            {application.editable && (
              <div className="flex justify-end">
                <Button onClick={handleSave} disabled={saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {application.status === "changes_requested" ? "Save and resubmit" : "Save changes"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
