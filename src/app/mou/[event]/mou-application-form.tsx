"use client"

// Online application to host an AMASI academic event.
//
// Adapted from design-references/tailwind-plus/form-layout-stacked-sections.tsx
// (section heading + helper text stacked beside a bordered form card, six-column
// field grid). Substitutions per AGENTS.md §2: shadcn Input/Textarea/Label/Button,
// lucide-react icons, CSS-variable colours.

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  RefreshCw,
  Upload,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { INDIAN_STATES } from "@/lib/membership-types"
import {
  MOU_ATTACHMENT_KEYS,
  MOU_ATTACHMENT_LABELS,
  MOU_EVENTS,
  MOU_STATUS_META,
  MOU_UPLOAD_MAX_BYTES,
  MOU_VENUE_TYPES,
  requiredMouAttachments,
  type MouAttachmentKey,
  type MouEventType,
  type MouField,
  type MouStatus,
  type MouVenueType,
} from "@/lib/mou-events"

type Phase = "checking" | "login" | "otp" | "form" | "done"

interface MemberSummary {
  name: string
  email: string
  amasi_number: string | number | null
  member_since: string | null
  mobile: string
  address: string
}

interface UploadedAttachment {
  key: MouAttachmentKey
  path: string
  filename: string
  size: number
  content_type: string
  url: string | null
}

interface MyApplication {
  id: string
  reference_number: string
  status: MouStatus
  place: string
  proposed_date: string | null
  proposed_year: number | null
  created_at: string
  decision_reason: string | null
  signed_mou_url: string | null
}

const OTP_LENGTH = 6
const SELECT_CLASS =
  "input-focus-ring flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function StatusDot({ status }: { status: MouStatus }) {
  const meta = MOU_STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className={cn("h-2 w-2 rounded-full", meta.dot)} aria-hidden />
      {meta.label}
    </span>
  )
}

function Section({
  title,
  help,
  children,
}: {
  title: string
  help: string
  children: React.ReactNode
}) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 py-8 md:grid-cols-3">
      <div>
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{help}</p>
      </div>
      <div className="rounded-md border bg-card md:col-span-2">
        <div className="grid grid-cols-1 gap-x-6 gap-y-6 p-6 sm:grid-cols-6">{children}</div>
      </div>
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="mt-1.5 text-xs text-destructive">{message}</p>
}

export function MouApplicationForm({ eventType }: { eventType: MouEventType }) {
  const config = MOU_EVENTS[eventType]
  const [phase, setPhase] = useState<Phase>("checking")
  const [member, setMember] = useState<MemberSummary | null>(null)
  const [myApps, setMyApps] = useState<MyApplication[]>([])

  // --- login state ------------------------------------------------------
  const [email, setEmail] = useState("")
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(""))
  const [isSending, setIsSending] = useState(false)
  const [isVerifying, setIsVerifying] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const [loginError, setLoginError] = useState<string | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  // --- form state -------------------------------------------------------
  const [eventTitle, setEventTitle] = useState("")
  const [proposedDate, setProposedDate] = useState("")
  const [proposedEndDate, setProposedEndDate] = useState("")
  const [proposedYear, setProposedYear] = useState<string>(String(new Date().getFullYear() + 1))
  const [place, setPlace] = useState("")
  const [state, setState] = useState("")
  const [venueName, setVenueName] = useState("")
  const [venueType, setVenueType] = useState<MouVenueType | "">("")
  const [joint, setJoint] = useState(false)
  const [partner, setPartner] = useState("")
  const [cityChapter, setCityChapter] = useState("")
  const [stateChapter, setStateChapter] = useState("")
  const [others, setOthers] = useState("")
  const [remarks, setRemarks] = useState("")
  const [details, setDetails] = useState<Record<string, string>>({})
  const [declarations, setDeclarations] = useState<Record<string, boolean>>({})
  const [attachments, setAttachments] = useState<Partial<Record<MouAttachmentKey, UploadedAttachment>>>({})
  const [uploading, setUploading] = useState<MouAttachmentKey | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ reference_number: string } | null>(null)

  const loadMyApplications = useCallback(async () => {
    try {
      const res = await fetch(`/api/mou/applications?event=${eventType}`)
      const data = await res.json()
      if (res.ok && data?.status) setMyApps(data.applications ?? [])
    } catch {
      /* non-blocking */
    }
  }, [eventType])

  const loadMember = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/member/me")
      if (res.status === 401) return false
      const data = await res.json()
      if (!res.ok || !data?.status) {
        setLoginError(data?.message || "Could not load your membership record.")
        return false
      }
      const m = data.member
      const baseName: string = (m.name || [m.first_name, m.last_name].filter(Boolean).join(" ") || "").trim()
      const salutation: string = (m.salutation || "").trim()
      setMember({
        name: salutation && !baseName.startsWith(salutation) ? `${salutation} ${baseName}` : baseName,
        email: m.email,
        amasi_number: m.amasi_number ?? null,
        member_since: m.member_since ?? null,
        mobile: m.mobile ? `${m.mobile_code || "+91"} ${m.mobile}` : "",
        address: [m.street_address_1, m.street_address_2, m.city, m.state, m.postal_code].filter(Boolean).join(", "),
      })
      if (m.state) setState((prev) => prev || m.state)
      return true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const ok = await loadMember()
      if (cancelled) return
      if (ok) {
        await loadMyApplications()
        if (!cancelled) setPhase("form")
      } else {
        setPhase("login")
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadMember, loadMyApplications])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // --- login handlers ---------------------------------------------------
  const sendOtp = async () => {
    const e = email.trim()
    if (!e) {
      setLoginError("Enter the email registered with AMASI")
      return
    }
    setIsSending(true)
    setLoginError(null)
    try {
      const res = await fetch("/api/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: e }),
      })
      const data = await res.json()
      if (data?.status) {
        setPhase("otp")
        setCooldown(60)
        toast.success("One-time code sent to your email")
      } else {
        setLoginError(data?.message || "Could not send the code")
      }
    } catch {
      setLoginError("Network error")
    } finally {
      setIsSending(false)
    }
  }

  const verifyOtp = async (code: string) => {
    setIsVerifying(true)
    setLoginError(null)
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code }),
      })
      const data = await res.json()
      if (!data?.status) {
        setLoginError(data?.message || "Invalid code")
        setDigits(Array(OTP_LENGTH).fill(""))
        inputRefs.current[0]?.focus()
        return
      }
      const ok = await loadMember()
      if (ok) {
        await loadMyApplications()
        setPhase("form")
      } else {
        setPhase("login")
      }
    } catch {
      setLoginError("Verification failed")
    } finally {
      setIsVerifying(false)
    }
  }

  const onDigit = (i: number, value: string) => {
    if (!/^\d*$/.test(value)) return
    const next = [...digits]
    next[i] = value.slice(-1)
    setDigits(next)
    if (value && i < OTP_LENGTH - 1) inputRefs.current[i + 1]?.focus()
    const code = next.join("")
    if (code.length === OTP_LENGTH) verifyOtp(code)
  }

  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, OTP_LENGTH)
    if (pasted.length === OTP_LENGTH) {
      setDigits(pasted.split(""))
      verifyOtp(pasted)
    }
  }

  // --- upload -----------------------------------------------------------
  const uploadFor = async (key: MouAttachmentKey, file: File) => {
    if (file.size > MOU_UPLOAD_MAX_BYTES) {
      toast.error("File exceeds the 10 MB limit")
      return
    }
    setUploading(key)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/mou/upload", { method: "POST", body: fd })
      const data = await res.json()
      if (!res.ok || !data?.status) {
        toast.error(data?.message || "Upload failed")
        return
      }
      setAttachments((prev) => ({ ...prev, [key]: { key, ...data.attachment, url: data.url ?? null } }))
      setErrors((prev) => {
        const next = { ...prev }
        delete next[`attachments.${key}`]
        delete next.attachments
        return next
      })
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploading(null)
    }
  }

  // --- submit -----------------------------------------------------------
  const requiredKeys = requiredMouAttachments({ venueType, jointWithAssociation: joint })
  const openApp = myApps.find((a) => a.status === "submitted" || a.status === "under_review")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})
    const payload = {
      event_type: eventType,
      event_title: eventTitle,
      proposed_date: proposedDate || null,
      proposed_end_date: proposedEndDate || null,
      proposed_year: config.scheduleMode === "year" ? Number(proposedYear) : null,
      place,
      state,
      venue_name: venueName,
      venue_type: venueType,
      joint_with_association: joint,
      partner_association: partner,
      supporting_city_chapter: cityChapter,
      supporting_state_chapter: stateChapter,
      supporting_others: others,
      remarks,
      details,
      declarations,
      attachments: Object.values(attachments).map((a) => ({
        key: a.key,
        path: a.path,
        filename: a.filename,
        size: a.size,
        content_type: a.content_type,
      })),
    }
    try {
      const res = await fetch("/api/mou/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.status === 401) {
        toast.error("Your session expired. Please sign in again.")
        setPhase("login")
        return
      }
      if (!res.ok || !data?.status) {
        if (data?.errors) {
          setErrors(data.errors)
          toast.error("Please correct the highlighted fields")
          window.scrollTo({ top: 0, behavior: "smooth" })
        } else {
          toast.error(data?.message || "Submission failed")
        }
        return
      }
      setResult({ reference_number: data.application.reference_number })
      setPhase("done")
      window.scrollTo({ top: 0 })
    } catch {
      toast.error("Submission failed")
    } finally {
      setSubmitting(false)
    }
  }

  // ======================================================================
  // Render
  // ======================================================================
  const header = (
    <div>
      <Link href="/mou" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All events
      </Link>
      <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">{config.eyebrow}</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">Apply to host: {config.name}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{config.description}</p>
    </div>
  )

  if (phase === "checking") {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        {header}
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
        </div>
      </div>
    )
  }

  if (phase === "login" || phase === "otp") {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        {header}
        <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-3">
          <div>
            <h2 className="text-base font-bold tracking-tight">Sign in as a member</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only bonafide AMASI members can apply. We will send a one-time code to your registered email.
            </p>
          </div>
          <div className="rounded-md border bg-card p-6 md:col-span-2 max-w-md space-y-4">
            {phase === "login" ? (
              <>
                <div>
                  <Label htmlFor="mou-email">Member email</Label>
                  <div className="relative mt-2">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="mou-email"
                      type="email"
                      autoComplete="email"
                      className="pl-9"
                      value={email}
                      disabled={isSending}
                      onChange={(e) => {
                        setEmail(e.target.value)
                        setLoginError(null)
                      }}
                      onKeyDown={(e) => e.key === "Enter" && sendOtp()}
                    />
                  </div>
                </div>
                {loginError && (
                  <p className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {loginError}
                  </p>
                )}
                <Button onClick={sendOtp} disabled={isSending || !email.trim()} className="w-full">
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Send one-time code
                </Button>
                <p className="text-xs text-muted-foreground">
                  Not a member yet?{" "}
                  <Link href="/apply" className="font-medium text-primary hover:underline">
                    Apply for membership
                  </Link>
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code sent to <span className="font-medium text-foreground">{email.trim()}</span>
                </p>
                <div className="flex gap-2" onPaste={onPaste}>
                  {digits.map((d, i) => (
                    <Input
                      key={i}
                      ref={(el) => {
                        inputRefs.current[i] = el
                      }}
                      inputMode="numeric"
                      maxLength={1}
                      aria-label={`Digit ${i + 1}`}
                      className="h-12 w-11 text-center text-lg"
                      value={d}
                      disabled={isVerifying}
                      onChange={(e) => onDigit(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Backspace" && !digits[i] && i > 0) inputRefs.current[i - 1]?.focus()
                      }}
                    />
                  ))}
                </div>
                {loginError && (
                  <p className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 shrink-0" /> {loginError}
                  </p>
                )}
                {isVerifying && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Verifying…
                  </p>
                )}
                <div className="flex items-center justify-between">
                  <Button variant="ghost" size="sm" onClick={sendOtp} disabled={isSending || cooldown > 0}>
                    <RefreshCw className="h-4 w-4" />
                    {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                  </Button>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => {
                      setPhase("login")
                      setDigits(Array(OTP_LENGTH).fill(""))
                      setLoginError(null)
                    }}
                  >
                    Use a different email
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (phase === "done" && result) {
    return (
      <div className="mx-auto max-w-5xl space-y-8">
        {header}
        <div className="rounded-md border bg-card p-8 max-w-2xl">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border bg-muted">
              <CheckCircle className="h-6 w-6 text-success" />
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight">Application submitted</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your reference number is <span className="font-mono text-foreground">{result.reference_number}</span>.
                A confirmation has been emailed to {member?.email}.
              </p>
              <p className="mt-4 text-sm text-muted-foreground">
                {config.decidedBy === "gbm"
                  ? "Valid AMASICON invitations are placed before the next General Body Meeting, where you will present your bid in person."
                  : "The Executive Committee will consider your request. HQ normally completes processing within two weeks of a complete application."}
              </p>
              <div className="mt-6 flex gap-3">
                <Button
                  variant="outline"
                  onClick={async () => {
                    await loadMyApplications()
                    setResult(null)
                    setPhase("form")
                  }}
                >
                  View my applications
                </Button>
                <Button variant="ghost" asChild>
                  <Link href="/mou">All events</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---- form phase -------------------------------------------------------
  const errorCount = Object.keys(errors).length

  return (
    <div className="mx-auto max-w-5xl">
      {header}

      {myApps.length > 0 && (
        <div className="mt-8 rounded-md border bg-card">
          <div className="border-b px-6 py-4">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Your applications</p>
          </div>
          <ul className="divide-y">
            {myApps.map((a) => (
              <li key={a.id} className="grid gap-2 px-6 py-4 sm:grid-cols-[1fr_auto] sm:items-start">
                <div>
                  <p className="text-sm font-medium">
                    <span className="font-mono">{a.reference_number}</span>
                    <span className="text-muted-foreground"> · {a.place} · {a.proposed_year ?? formatDate(a.proposed_date)}</span>
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">{MOU_STATUS_META[a.status].applicantText}</p>
                  {a.decision_reason && (a.status === "rejected" || a.status === "approved") && (
                    <p className="mt-2 rounded-md border bg-muted p-3 text-sm whitespace-pre-wrap">{a.decision_reason}</p>
                  )}
                  {a.signed_mou_url && (
                    <a
                      href={a.signed_mou_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      <FileText className="h-4 w-4" /> Signed MOU <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="text-right">
                  <StatusDot status={a.status} />
                  <p className="mt-1 text-xs text-muted-foreground">{formatDate(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {openApp ? (
        <div className="mt-8 rounded-md border bg-card p-6 max-w-2xl">
          <p className="text-sm font-medium">An application is already in progress</p>
          <p className="mt-1 text-sm text-muted-foreground">
            AMASI HQ is processing {openApp.reference_number}. You can file a new application for this event once it
            is decided. For changes, write to{" "}
            <a href="mailto:amasi.india@gmail.com" className="font-medium text-primary hover:underline">
              amasi.india@gmail.com
            </a>{" "}
            quoting the reference number.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="divide-y">
          {errorCount > 0 && (
            <div className="mt-8 flex items-start gap-3 rounded-md border border-destructive/40 bg-card p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div>
                <p className="font-medium">Please correct {errorCount} {errorCount === 1 ? "field" : "fields"}</p>
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {Object.values(errors).slice(0, 8).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <Section
            title="Before you apply"
            help={
              config.mouUrl
                ? "The MOU you will sign if selected. Read it in full — the summary here is not a substitute."
                : "The MOU is issued by AMASI HQ on approval. These are the standing obligations for AMASI course hosts."
            }
          >
            <ul className="col-span-full space-y-2 text-sm">
              {config.keyTerms.map((t) => (
                <li key={t} className="flex gap-2">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                  <span className="text-muted-foreground">{t}</span>
                </li>
              ))}
            </ul>
            {config.mouUrl && (
              <a
                href={config.mouUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="col-span-full inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <FileText className="h-4 w-4" /> Open the draft MOU (PDF) <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </Section>

          <Section title="Applicant" help="Taken from your membership record. Update your profile in the member portal if anything is out of date.">
            <div className="sm:col-span-3">
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="mt-1 text-sm font-medium">{member?.name}</p>
            </div>
            <div className="sm:col-span-3">
              <p className="text-xs text-muted-foreground">AMASI membership number</p>
              <p className="mt-1 text-sm font-medium">{member?.amasi_number ?? "—"}</p>
            </div>
            <div className="sm:col-span-3">
              <p className="text-xs text-muted-foreground">Member since</p>
              <p className="mt-1 text-sm font-medium">{formatDate(member?.member_since ?? null)}</p>
            </div>
            <div className="sm:col-span-3">
              <p className="text-xs text-muted-foreground">Email · mobile</p>
              <p className="mt-1 text-sm font-medium">
                {member?.email}
                {member?.mobile ? ` · ${member.mobile}` : ""}
              </p>
            </div>
            <div className="col-span-full">
              <p className="text-xs text-muted-foreground">Address</p>
              <p className="mt-1 text-sm font-medium">{member?.address || "—"}</p>
            </div>
          </Section>

          <Section title="Event and venue" help="Where and when you propose to hold the event. The venue is subject to endorsement by the Executive Committee.">
            {config.scheduleMode === "year" ? (
              <div className="sm:col-span-2">
                <Label htmlFor="proposed_year">Conference year</Label>
                <Input
                  id="proposed_year"
                  type="number"
                  className="mt-2"
                  min={new Date().getFullYear()}
                  max={new Date().getFullYear() + 6}
                  value={proposedYear}
                  onChange={(e) => setProposedYear(e.target.value)}
                />
                <FieldError message={errors.proposed_year} />
              </div>
            ) : (
              <>
                <div className="sm:col-span-3">
                  <Label htmlFor="proposed_date">{config.scheduleMode === "date-range" ? "Start date" : "Proposed date"}</Label>
                  <Input
                    id="proposed_date"
                    type="date"
                    className="mt-2"
                    min={todayIso()}
                    value={proposedDate}
                    onChange={(e) => setProposedDate(e.target.value)}
                  />
                  <FieldError message={errors.proposed_date} />
                </div>
                {config.scheduleMode === "date-range" && (
                  <div className="sm:col-span-3">
                    <Label htmlFor="proposed_end_date">End date (if more than one day)</Label>
                    <Input
                      id="proposed_end_date"
                      type="date"
                      className="mt-2"
                      min={proposedDate || todayIso()}
                      value={proposedEndDate}
                      onChange={(e) => setProposedEndDate(e.target.value)}
                    />
                    <FieldError message={errors.proposed_end_date} />
                  </div>
                )}
              </>
            )}

            {config.slug !== "amasicon" && (
              <div className="col-span-full">
                <Label htmlFor="event_title">Event title (as it will appear on the brochure)</Label>
                <Input
                  id="event_title"
                  className="mt-2"
                  maxLength={200}
                  value={eventTitle}
                  onChange={(e) => setEventTitle(e.target.value)}
                />
              </div>
            )}

            <div className="sm:col-span-3">
              <Label htmlFor="place">City / town</Label>
              <Input id="place" className="mt-2" maxLength={120} value={place} onChange={(e) => setPlace(e.target.value)} />
              <FieldError message={errors.place} />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="state">State</Label>
              <select id="state" className={cn(SELECT_CLASS, "mt-2")} value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <FieldError message={errors.state} />
            </div>

            <div className="col-span-full">
              <Label htmlFor="venue_name">Venue / institution</Label>
              <Input
                id="venue_name"
                className="mt-2"
                maxLength={200}
                placeholder="Hospital, college or convention centre"
                value={venueName}
                onChange={(e) => setVenueName(e.target.value)}
              />
              <FieldError message={errors.venue_name} />
            </div>

            <fieldset className="col-span-full">
              <legend className="text-sm font-medium">The venue is</legend>
              <div className="mt-2 space-y-2">
                {MOU_VENUE_TYPES.map((v) => (
                  <label key={v.value} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary">
                    <input
                      type="radio"
                      name="venue_type"
                      className="mt-0.5"
                      value={v.value}
                      checked={venueType === v.value}
                      onChange={() => setVenueType(v.value)}
                    />
                    <span>
                      <span className="block text-sm font-medium">{v.label}</span>
                      <span className="block text-xs text-muted-foreground">{v.help}</span>
                    </span>
                  </label>
                ))}
              </div>
              <FieldError message={errors.venue_type} />
            </fieldset>

            <div className="col-span-full">
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" className="mt-1" checked={joint} onChange={(e) => setJoint(e.target.checked)} />
                <span className="text-sm">
                  <span className="font-medium">Held jointly with another association</span>
                  <span className="block text-xs text-muted-foreground">Requires a consent letter from the partner association.</span>
                </span>
              </label>
              {joint && (
                <div className="mt-3">
                  <Label htmlFor="partner">Partner association</Label>
                  <Input id="partner" className="mt-2" maxLength={200} value={partner} onChange={(e) => setPartner(e.target.value)} />
                  <FieldError message={errors.partner_association} />
                </div>
              )}
            </div>
          </Section>

          <Section title={`${config.shortName} details`} help="Specific to this event type. Be concrete — the committee decides on what is written here.">
            {config.fields.map((f) => (
              <DetailField
                key={f.key}
                field={f}
                value={details[f.key] ?? ""}
                error={errors[`details.${f.key}`]}
                onChange={(v) => setDetails((prev) => ({ ...prev, [f.key]: v }))}
              />
            ))}
          </Section>

          <Section title="Supporting associations" help="Optional. Chapters of the Association of Surgeons of India or other bodies backing this bid.">
            <div className="sm:col-span-3">
              <Label htmlFor="city_chapter">City chapter of ASI</Label>
              <Input id="city_chapter" className="mt-2" maxLength={200} value={cityChapter} onChange={(e) => setCityChapter(e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <Label htmlFor="state_chapter">State chapter of ASI</Label>
              <Input id="state_chapter" className="mt-2" maxLength={200} value={stateChapter} onChange={(e) => setStateChapter(e.target.value)} />
            </div>
            <div className="col-span-full">
              <Label htmlFor="others">Others</Label>
              <Input id="others" className="mt-2" maxLength={200} value={others} onChange={(e) => setOthers(e.target.value)} />
            </div>
          </Section>

          <Section title="Documents" help="PDF, JPG or PNG up to 10 MB each. Required documents depend on the venue and partnership answers above.">
            {MOU_ATTACHMENT_KEYS.map((key) => {
              const required = requiredKeys.includes(key)
              const optionalOnly = key === "letterhead_letter" || key === "other"
              if (!required && !optionalOnly) return null
              const current = attachments[key]
              return (
                <div key={key} className="col-span-full">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor={`file-${key}`}>
                      {MOU_ATTACHMENT_LABELS[key]}
                      {required && <span className="text-destructive"> *</span>}
                    </Label>
                  </div>
                  {current ? (
                    <div className="mt-2 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <CheckCircle className="h-4 w-4 shrink-0 text-success" />
                        <span className="truncate">{current.filename}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">{(current.size / 1024).toFixed(0)} KB</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        {current.url && (
                          <a href={current.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-primary hover:underline">
                            View
                          </a>
                        )}
                        <button
                          type="button"
                          aria-label="Remove file"
                          className="rounded-sm p-1 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            setAttachments((prev) => {
                              const next = { ...prev }
                              delete next[key]
                              return next
                            })
                          }
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </span>
                    </div>
                  ) : (
                    <label
                      htmlFor={`file-${key}`}
                      className={cn(
                        "mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground hover:border-primary",
                        errors[`attachments.${key}`] && "border-destructive"
                      )}
                    >
                      {uploading === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploading === key ? "Uploading…" : "Choose a file"}
                      <input
                        id={`file-${key}`}
                        type="file"
                        accept="application/pdf,image/jpeg,image/png"
                        className="sr-only"
                        disabled={uploading !== null}
                        onChange={(e) => {
                          const f = e.target.files?.[0]
                          if (f) uploadFor(key, f)
                          e.target.value = ""
                        }}
                      />
                    </label>
                  )}
                  <FieldError message={errors[`attachments.${key}`]} />
                </div>
              )
            })}
            <FieldError message={errors.attachments} />
          </Section>

          <Section title="Declarations" help="These replace the signed statements in the letterhead application.">
            {config.declarations.map((d) => (
              <div key={d.key} className="col-span-full">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={!!declarations[d.key]}
                    onChange={(e) => setDeclarations((prev) => ({ ...prev, [d.key]: e.target.checked }))}
                  />
                  <span className="text-sm">{d.text}</span>
                </label>
                <FieldError message={errors[`declarations.${d.key}`]} />
              </div>
            ))}
            <div className="col-span-full">
              <Label htmlFor="remarks">Anything else the committee should know (optional)</Label>
              <Textarea id="remarks" className="mt-2" rows={3} maxLength={3000} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </div>
          </Section>

          <div className="flex items-center justify-end gap-3 py-8">
            <Button variant="ghost" type="button" asChild>
              <Link href="/mou">Cancel</Link>
            </Button>
            <Button type="submit" disabled={submitting || uploading !== null}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Submit application
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}

function DetailField({
  field,
  value,
  error,
  onChange,
}: {
  field: MouField
  value: string
  error?: string
  onChange: (v: string) => void
}) {
  const span = field.span === "full" ? "col-span-full" : "sm:col-span-3"
  const id = `detail-${field.key}`
  return (
    <div className={span}>
      <Label htmlFor={id}>
        {field.label}
        {field.required && <span className="text-destructive"> *</span>}
      </Label>
      {field.kind === "textarea" ? (
        <Textarea id={id} className="mt-2" rows={3} maxLength={field.maxLength} placeholder={field.placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : field.kind === "select" ? (
        <select id={id} className={cn(SELECT_CLASS, "mt-2")} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Select</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          className="mt-2"
          type={field.kind === "number" ? "number" : "text"}
          min={field.min}
          max={field.max}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.help && !error && <p className="mt-1.5 text-xs text-muted-foreground">{field.help}</p>}
      <FieldError message={error} />
    </div>
  )
}
