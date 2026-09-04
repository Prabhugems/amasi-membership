"use client"

import { useState, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Search, Loader2, CheckCircle2, Mail, ShieldCheck, Upload, X, Send,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import type { ApplicationTypeId } from "@/lib/mou/types"

type Zone = "" | "North" | "South" | "East" | "West" | "Central"

interface FormState {
  organizer_name: string
  email: string
  phone_number: string
  applicant_amasi_number: string
  primary_institution: string
  preferred_date_1: string
  preferred_date_2: string
  venue_type: string
  venue_name: string
  venue_address: string
  venue_city: string
  venue_state: string
  venue_zip: string
  venue_country: string
  zone: Zone
  auditorium_hall_a: boolean
  auditorium_hall_b: boolean
  av_equipment: boolean
  endotrainers: boolean
  high_speed_internet: boolean
  expected_participants: string
  live_surgery_demo: boolean
  event_name: string
  agree_terms: boolean
  certify_accurate: boolean
  authority_confirm: boolean
  committee_member_photo_url: string
  institution_photo_url: string
}

const INITIAL_STATE: FormState = {
  organizer_name: "",
  email: "",
  phone_number: "",
  applicant_amasi_number: "",
  primary_institution: "",
  preferred_date_1: "",
  preferred_date_2: "",
  venue_type: "",
  venue_name: "",
  venue_address: "",
  venue_city: "",
  venue_state: "",
  venue_zip: "",
  venue_country: "India",
  zone: "",
  auditorium_hall_a: false,
  auditorium_hall_b: false,
  av_equipment: false,
  endotrainers: false,
  high_speed_internet: false,
  expected_participants: "",
  live_surgery_demo: false,
  event_name: "",
  agree_terms: false,
  certify_accurate: false,
  authority_confirm: false,
  committee_member_photo_url: "",
  institution_photo_url: "",
}

const ZONES: Zone[] = ["North", "South", "East", "West", "Central"]

interface FieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
  type?: string
  placeholder?: string
}

function Field({ label, value, onChange, required, type = "text", placeholder }: FieldProps) {
  return (
    <div>
      <Label className="text-xs">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1"
      />
    </div>
  )
}

function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={cn("flex items-start gap-2 text-sm", disabled ? "opacity-50" : "cursor-pointer")}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-input"
      />
      <span>{label}</span>
    </label>
  )
}

function PhotoUploadField({
  label,
  url,
  onUploaded,
  onClear,
  uploading,
  disabled,
  disabledReason,
}: {
  label: string
  url: string
  onUploaded: (file: File) => void
  onClear: () => void
  uploading: boolean
  disabled: boolean
  disabledReason: string
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      {url ? (
        <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
          <span className="flex items-center gap-1.5 text-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" />
            Uploaded
          </span>
          <button type="button" onClick={onClear} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="mt-1">
          <label
            className={cn(
              "flex items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground",
              disabled ? "opacity-50" : "cursor-pointer hover:border-primary/50"
            )}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Click to upload (JPG, PNG, or PDF, max 5MB)"}
            <input
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              className="hidden"
              disabled={disabled || uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUploaded(file)
                e.target.value = ""
              }}
            />
          </label>
          {disabled && <p className="mt-1 text-xs text-muted-foreground">{disabledReason}</p>}
        </div>
      )}
    </div>
  )
}

export function ApplicationForm({ typeId }: { typeId: ApplicationTypeId }) {
  const router = useRouter()
  const typeConfig = getEventTypeConfig(typeId)
  const fields = useMemo(() => new Set(typeConfig?.fields ?? []), [typeConfig])

  const [form, setForm] = useState<FormState>(INITIAL_STATE)
  const set = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }, [])

  // (a) Membership lookup — a match prefills display fields but never locks
  // the form; the applicant can still edit anything it filled in.
  const [lookupQuery, setLookupQuery] = useState("")
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupMessage, setLookupMessage] = useState<string | null>(null)

  const runLookup = useCallback(async () => {
    if (lookupQuery.trim().length < 3) {
      setLookupMessage("Enter at least 3 characters.")
      return
    }
    setLookingUp(true)
    setLookupMessage(null)
    try {
      const res = await fetch(`/api/mou/member-lookup?q=${encodeURIComponent(lookupQuery.trim())}`)
      const data = await res.json()
      if (!data.status) {
        setLookupMessage(data.message || "Lookup failed")
        return
      }
      if (!data.member) {
        setLookupMessage("No matching member found — you can still fill the form manually.")
        return
      }
      setForm((prev) => ({
        ...prev,
        organizer_name: prev.organizer_name || data.member.name || "",
        email: prev.email || data.member.email || "",
        phone_number: prev.phone_number || String(data.member.phone ?? ""),
        applicant_amasi_number: prev.applicant_amasi_number || String(data.member.amasi_number ?? ""),
      }))
      setLookupMessage(`Matched: ${data.member.name} (AMASI #${data.member.amasi_number}). Fields prefilled — edit anything that needs updating.`)
    } catch {
      setLookupMessage("Lookup failed. Please try again or fill the form manually.")
    } finally {
      setLookingUp(false)
    }
  }, [lookupQuery])

  // (e)/(f) OTP verification, gated to the current email field.
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null)
  const [sendingOtp, setSendingOtp] = useState(false)
  const [otpCode, setOtpCode] = useState("")
  const [verifyingOtp, setVerifyingOtp] = useState(false)
  const [emailVerified, setEmailVerified] = useState(false)

  const sendOtp = useCallback(async () => {
    if (!form.email.trim()) {
      toast.error("Enter your email first")
      return
    }
    setSendingOtp(true)
    try {
      const res = await fetch("/api/mou/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim() }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Could not send verification code")
        return
      }
      setOtpSentTo(form.email.trim())
      toast.success("Verification code sent — check your email")
    } catch {
      toast.error("Could not send verification code. Please try again.")
    } finally {
      setSendingOtp(false)
    }
  }, [form.email])

  const verifyOtp = useCallback(async () => {
    if (!otpCode.trim()) {
      toast.error("Enter the verification code")
      return
    }
    setVerifyingOtp(true)
    try {
      const res = await fetch("/api/mou/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email.trim(), code: otpCode.trim() }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Invalid or expired code")
        return
      }
      setEmailVerified(true)
      toast.success("Email verified")
    } catch {
      toast.error("Could not verify code. Please try again.")
    } finally {
      setVerifyingOtp(false)
    }
  }, [form.email, otpCode])

  // Photo uploads — the API requires the email to already be OTP-verified
  // (see src/app/api/mou/applications/upload/route.ts), so the fields are
  // disabled with an explanatory note until emailVerified is true.
  const [uploadingCommittee, setUploadingCommittee] = useState(false)
  const [uploadingInstitution, setUploadingInstitution] = useState(false)

  const uploadPhoto = useCallback(
    async (file: File, docType: "committee_member_photo" | "institution_photo") => {
      const setUploading = docType === "committee_member_photo" ? setUploadingCommittee : setUploadingInstitution
      setUploading(true)
      try {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("docType", docType)
        fd.append("email", form.email.trim())
        const res = await fetch("/api/mou/applications/upload", { method: "POST", body: fd })
        const data = await res.json()
        if (!data.status) {
          toast.error(data.message || "Upload failed")
          return
        }
        if (docType === "committee_member_photo") set("committee_member_photo_url", data.url)
        else set("institution_photo_url", data.url)
        toast.success("Photo uploaded")
      } catch {
        toast.error("Upload failed. Please try again.")
      } finally {
        setUploading(false)
      }
    },
    [form.email, set]
  )

  const [submitting, setSubmitting] = useState(false)

  const requiredFieldsFilled =
    form.organizer_name.trim() &&
    form.email.trim() &&
    form.phone_number.trim() &&
    form.primary_institution.trim() &&
    form.preferred_date_1.trim() &&
    (!fields.has("zone") || form.zone) &&
    form.agree_terms &&
    form.certify_accurate &&
    form.authority_confirm

  const canSubmit = !!requiredFieldsFilled && emailVerified && !submitting

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const payload: Record<string, unknown> = {
        application_type_id: typeId,
        organizer_name: form.organizer_name.trim(),
        email: form.email.trim(),
        phone_number: form.phone_number.trim(),
        primary_institution: form.primary_institution.trim(),
        preferred_date_1: form.preferred_date_1,
        preferred_date_2: form.preferred_date_2 || undefined,
        venue_type: form.venue_type || undefined,
        venue_name: form.venue_name || undefined,
        venue_address: form.venue_address || undefined,
        venue_city: form.venue_city || undefined,
        venue_state: form.venue_state || undefined,
        venue_zip: form.venue_zip || undefined,
        venue_country: form.venue_country || undefined,
        agree_terms: form.agree_terms,
        certify_accurate: form.certify_accurate,
        authority_confirm: form.authority_confirm,
      }
      if (form.applicant_amasi_number.trim()) payload.applicant_amasi_number = form.applicant_amasi_number.trim()
      if (fields.has("zone") && form.zone) payload.zone = form.zone
      if (fields.has("auditorium_facilities")) {
        payload.auditorium_hall_a = form.auditorium_hall_a
        payload.auditorium_hall_b = form.auditorium_hall_b
        payload.av_equipment = form.av_equipment
        payload.endotrainers = form.endotrainers
      }
      if (fields.has("high_speed_internet")) payload.high_speed_internet = form.high_speed_internet
      if (fields.has("expected_participants") && form.expected_participants.trim()) {
        payload.expected_participants = form.expected_participants.trim()
      }
      if (fields.has("live_surgery_demo")) payload.live_surgery_demo = form.live_surgery_demo
      if (fields.has("event_name") && form.event_name.trim()) payload.event_name = form.event_name.trim()
      if (fields.has("committee_member_photo") && form.committee_member_photo_url) {
        payload.committee_member_photo_url = form.committee_member_photo_url
      }
      if (fields.has("institution_photo") && form.institution_photo_url) {
        payload.institution_photo_url = form.institution_photo_url
      }

      const res = await fetch("/api/mou/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Could not submit application")
        return
      }
      router.push(`/mou/status/${data.applicationId}`)
    } catch {
      toast.error("Could not submit application. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, form, typeId, fields, router])

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Already an AMASI member?</CardTitle>
          <CardDescription>Look up your membership number or email to prefill your details.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex gap-2">
            <Input
              value={lookupQuery}
              onChange={(e) => setLookupQuery(e.target.value)}
              placeholder="AMASI membership number or email"
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), runLookup())}
            />
            <Button type="button" variant="outline" onClick={runLookup} disabled={lookingUp}>
              {lookingUp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Look up
            </Button>
          </div>
          {lookupMessage && <p className="text-xs text-muted-foreground">{lookupMessage}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Organizer &amp; contact details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Organizer name" required value={form.organizer_name} onChange={(v) => set("organizer_name", v)} />
            <Field label="Primary institution" required value={form.primary_institution} onChange={(v) => set("primary_institution", v)} />
            <Field label="Email" required type="email" value={form.email} onChange={(v) => { set("email", v); setEmailVerified(false); setOtpSentTo(null) }} />
            <Field label="Phone number" required type="tel" value={form.phone_number} onChange={(v) => set("phone_number", v)} />
            {fields.has("amasi_membership_number") && (
              <Field label="AMASI membership number" value={form.applicant_amasi_number} onChange={(v) => set("applicant_amasi_number", v)} />
            )}
          </div>

          <div className="rounded-md border border-border bg-muted/30 p-3">
            {emailVerified ? (
              <p className="flex items-center gap-1.5 text-sm text-success font-medium">
                <ShieldCheck className="h-4 w-4" />
                Email verified
              </p>
            ) : (
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3.5 w-3.5" />
                  Verify your email before submitting.
                </p>
                {!otpSentTo ? (
                  <Button type="button" size="sm" variant="outline" onClick={sendOtp} disabled={sendingOtp || !form.email.trim()}>
                    {sendingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send verification code
                  </Button>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={otpCode}
                      onChange={(e) => setOtpCode(e.target.value)}
                      placeholder="6-digit code"
                      className="w-32"
                    />
                    <Button type="button" size="sm" onClick={verifyOtp} disabled={verifyingOtp}>
                      {verifyingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={sendOtp} disabled={sendingOtp}>
                      Resend code
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Event details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Preferred date" required type="date" value={form.preferred_date_1} onChange={(v) => set("preferred_date_1", v)} />
            <Field label="Alternate date" type="date" value={form.preferred_date_2} onChange={(v) => set("preferred_date_2", v)} />
            {fields.has("event_name") && (
              <Field label="Event name" value={form.event_name} onChange={(v) => set("event_name", v)} />
            )}
            {fields.has("expected_participants") && (
              <Field label="Expected participants" type="number" value={form.expected_participants} onChange={(v) => set("expected_participants", v)} />
            )}
            {fields.has("zone") && (
              <div>
                <Label className="text-xs">
                  Zone<span className="text-destructive ml-0.5">*</span>
                </Label>
                <select
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.zone}
                  onChange={(e) => set("zone", e.target.value as Zone)}
                >
                  <option value="">Select...</option>
                  {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                </select>
              </div>
            )}
          </div>
          {fields.has("live_surgery_demo") && (
            <CheckboxField label="This event will include a live surgery demonstration" checked={form.live_surgery_demo} onChange={(v) => set("live_surgery_demo", v)} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Venue</CardTitle>
          <CardDescription>Optional — fill in if already finalized.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Venue type" value={form.venue_type} onChange={(v) => set("venue_type", v)} placeholder="e.g. Hotel, Auditorium" />
            <Field label="Venue name" value={form.venue_name} onChange={(v) => set("venue_name", v)} />
            <Field label="Address" value={form.venue_address} onChange={(v) => set("venue_address", v)} />
            <Field label="City" value={form.venue_city} onChange={(v) => set("venue_city", v)} />
            <Field label="State" value={form.venue_state} onChange={(v) => set("venue_state", v)} />
            <Field label="ZIP / PIN" value={form.venue_zip} onChange={(v) => set("venue_zip", v)} />
            <Field label="Country" value={form.venue_country} onChange={(v) => set("venue_country", v)} />
          </div>

          {fields.has("high_speed_internet") && (
            <CheckboxField label="High-speed internet is available at the venue" checked={form.high_speed_internet} onChange={(v) => set("high_speed_internet", v)} />
          )}

          {fields.has("auditorium_facilities") && (
            <div>
              <Label className="text-xs">Auditorium facilities</Label>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <CheckboxField label="Hall A" checked={form.auditorium_hall_a} onChange={(v) => set("auditorium_hall_a", v)} />
                <CheckboxField label="Hall B" checked={form.auditorium_hall_b} onChange={(v) => set("auditorium_hall_b", v)} />
                <CheckboxField label="AV equipment" checked={form.av_equipment} onChange={(v) => set("av_equipment", v)} />
                <CheckboxField label="Endotrainers" checked={form.endotrainers} onChange={(v) => set("endotrainers", v)} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {(fields.has("committee_member_photo") || fields.has("institution_photo")) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold">Supporting photos</CardTitle>
            <CardDescription>
              {emailVerified ? "Optional — attach if available." : "Verify your email above before attaching photos."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {fields.has("committee_member_photo") && (
              <PhotoUploadField
                label="Committee member photo"
                url={form.committee_member_photo_url}
                uploading={uploadingCommittee}
                disabled={!emailVerified}
                disabledReason="Verify your email above first."
                onUploaded={(file) => uploadPhoto(file, "committee_member_photo")}
                onClear={() => set("committee_member_photo_url", "")}
              />
            )}
            {fields.has("institution_photo") && (
              <PhotoUploadField
                label="Institution photo"
                url={form.institution_photo_url}
                uploading={uploadingInstitution}
                disabled={!emailVerified}
                disabledReason="Verify your email above first."
                onUploaded={(file) => uploadPhoto(file, "institution_photo")}
                onClear={() => set("institution_photo_url", "")}
              />
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Agreements</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CheckboxField label="I agree to the AMASI terms and conditions for hosting this event." checked={form.agree_terms} onChange={(v) => set("agree_terms", v)} />
          <CheckboxField label="I certify that all information provided in this application is accurate." checked={form.certify_accurate} onChange={(v) => set("certify_accurate", v)} />
          <CheckboxField label="I confirm I have the authority to submit this application on behalf of my institution." checked={form.authority_confirm} onChange={(v) => set("authority_confirm", v)} />
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="button" size="lg" onClick={handleSubmit} disabled={!canSubmit}>
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Submit application
        </Button>
      </div>
    </div>
  )
}
