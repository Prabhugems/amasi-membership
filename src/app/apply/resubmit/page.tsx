"use client"

import { Suspense, useState, useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Loader2, FileEdit, AlertCircle, CheckCircle, Upload, Info, ExternalLink,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { INDIAN_STATES } from "@/lib/membership-types"

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ApplicationData {
  id: string
  reference_number: string
  name: string
  first_name: string
  middle_name: string
  last_name: string
  salutation: string
  email: string
  phone: string
  membership_type: string
  status: string
  payment_status: string
  review_notes: string | null
  created_at: string
  reviewed_at: string | null
  // Full detail fields (populated when API returns them)
  date_of_birth?: string
  gender?: string
  father_name?: string
  street_address_1?: string
  street_address_2?: string
  city?: string
  state?: string
  postal_code?: string
  country?: string
  pg_degree?: string
  pg_college?: string
  pg_university?: string
  pg_year?: string
  ug_college?: string
  mci_council_number?: string
  mci_council_state?: string
  asi_membership_no?: string
  documents?: Record<string, { url?: string; status?: string }>
}

type Phase = "loading" | "form" | "submitting" | "success" | "error"

interface FormState {
  salutation: string
  firstName: string
  middleName: string
  lastName: string
  fatherName: string
  dob: string
  gender: string
  phone: string
  email: string
  streetLine1: string
  streetLine2: string
  city: string
  state: string
  pin: string
  country: string
  pgDegree: string
  pgCollege: string
  pgUniversity: string
  pgYear: string
  ugCollege: string
  mciCouncilNumber: string
  mciCouncilState: string
  asiMembershipNo: string
}

const SALUTATIONS = ["Dr.", "Prof.", "Mr.", "Mrs.", "Ms."] as const
const GENDERS = ["Male", "Female", "Other"] as const

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function statusBadgeVariant(status: string) {
  switch (status) {
    case "approved":
    case "ai_approved":
      return "success" as const
    case "rejected":
      return "destructive" as const
    case "need_clarification":
    case "resubmit_requested":
      return "warning" as const
    default:
      return "secondary" as const
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "approved": return "Approved"
    case "rejected": return "Rejected"
    case "ai_approved": return "AI Approved"
    case "pending_review": return "Under Review"
    case "submitted": return "Submitted"
    case "need_clarification": return "Clarification Needed"
    case "resubmit_requested": return "Resubmit Requested"
    default: return status
  }
}

function membershipTypeLabel(type: string) {
  switch (type) {
    case "LM": return "Life Member"
    case "ALM": return "Associate Life Member"
    case "ACM": return "Associate Candidate Member"
    case "ILM": return "International Life Member"
    default: return type
  }
}

function getFileName(url: string): string {
  try {
    const parts = url.split("/")
    const last = parts[parts.length - 1]
    return decodeURIComponent(last.split("?")[0]) || "uploaded file"
  } catch {
    return "uploaded file"
  }
}

/* ------------------------------------------------------------------ */
/*  Form field components                                              */
/* ------------------------------------------------------------------ */

function FieldInput({
  label, name, value, onChange, required, readOnly, type = "text", placeholder,
}: {
  label: string; name: string; value: string; onChange: (name: string, val: string) => void
  required?: boolean; readOnly?: boolean; type?: string; placeholder?: string
}) {
  return (
    <div>
      <Label className="text-xs flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={readOnly ? "bg-muted cursor-not-allowed" : ""}
      />
    </div>
  )
}

function FieldSelect({
  label, name, value, options, onChange, required,
}: {
  label: string; name: string; value: string; options: readonly string[]; onChange: (name: string, val: string) => void
  required?: boolean
}) {
  return (
    <div>
      <Label className="text-xs flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
      </Label>
      <select
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(name, e.target.value)}
      >
        <option value="">Select...</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main content component                                             */
/* ------------------------------------------------------------------ */

function ResubmitContent() {
  const searchParams = useSearchParams()
  const ref = searchParams.get("ref") || ""

  const [phase, setPhase] = useState<Phase>("loading")
  const [application, setApplication] = useState<ApplicationData | null>(null)
  const [errorMessage, setErrorMessage] = useState("")
  const [successMessage, setSuccessMessage] = useState("")

  const [form, setForm] = useState<FormState>({
    salutation: "", firstName: "", middleName: "", lastName: "",
    fatherName: "", dob: "", gender: "", phone: "", email: "",
    streetLine1: "", streetLine2: "", city: "", state: "", pin: "", country: "India",
    pgDegree: "", pgCollege: "", pgUniversity: "", pgYear: "", ugCollege: "",
    mciCouncilNumber: "", mciCouncilState: "", asiMembershipNo: "",
  })

  const [files, setFiles] = useState<Record<string, File | null>>({
    photo: null,
    pg_certificate: null,
    mci_certificate: null,
  })

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  /* ---- Fetch application on mount ---- */
  useEffect(() => {
    if (!ref) {
      setErrorMessage("No reference number provided. Please use the link from your status page.")
      setPhase("error")
      return
    }

    let cancelled = false

    fetch(`/api/applications/status?ref=${encodeURIComponent(ref)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return

        if (!json.status || !json.data) {
          setErrorMessage(json.message || "Application not found. Please check your reference number.")
          setPhase("error")
          return
        }

        const app: ApplicationData = json.data
        setApplication(app)

        // Check if the application can be edited
        if (!["need_clarification", "resubmit_requested"].includes(app.status)) {
          if (app.status === "approved" || app.status === "ai_approved") {
            setErrorMessage("This application has already been approved. No changes are needed.")
          } else if (app.status === "rejected") {
            setErrorMessage("This application has been rejected. Please submit a new application if you wish to reapply.")
          } else {
            setErrorMessage("This application cannot be edited at this time. Current status: " + statusLabel(app.status))
          }
          setPhase("error")
          return
        }

        // Pre-fill form from application data
        setForm({
          salutation: app.salutation || "",
          firstName: app.first_name || "",
          middleName: app.middle_name || "",
          lastName: app.last_name || "",
          fatherName: app.father_name || "",
          dob: app.date_of_birth || "",
          gender: app.gender || "",
          phone: app.phone || "",
          email: app.email || "",
          streetLine1: app.street_address_1 || "",
          streetLine2: app.street_address_2 || "",
          city: app.city || "",
          state: app.state || "",
          pin: app.postal_code || "",
          country: app.country || "India",
          pgDegree: app.pg_degree || "",
          pgCollege: app.pg_college || "",
          pgUniversity: app.pg_university || "",
          pgYear: app.pg_year || "",
          ugCollege: app.ug_college || "",
          mciCouncilNumber: app.mci_council_number || "",
          mciCouncilState: app.mci_council_state || "",
          asiMembershipNo: app.asi_membership_no || "",
        })

        setPhase("form")
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMessage("Failed to load application. Please try again later.")
          setPhase("error")
        }
      })

    return () => { cancelled = true }
  }, [ref])

  /* ---- Form change handler ---- */
  const handleChange = (name: string, value: string) => {
    setForm((prev) => ({ ...prev, [name]: value }))
  }

  /* ---- File change handler ---- */
  const handleFileChange = (key: string, file: File | null) => {
    setFiles((prev) => ({ ...prev, [key]: file }))
  }

  /* ---- Submit handler ---- */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!application) return

    // Client-side validation for required fields
    if (!form.firstName.trim() || !form.salutation.trim() || !form.mciCouncilNumber.trim()) {
      toast.error("Please fill in all required fields")
      return
    }

    setPhase("submitting")

    try {
      const updates = {
        salutation: form.salutation,
        firstName: form.firstName,
        middleName: form.middleName,
        lastName: form.lastName,
        fatherName: form.fatherName,
        dateOfBirth: form.dob || null,
        gender: form.gender,
        addressLine1: form.streetLine1,
        addressLine2: form.streetLine2,
        city: form.city,
        state: form.state,
        pinCode: form.pin,
        country: form.country,
        pgDegree: form.pgDegree,
        pgCollege: form.pgCollege,
        pgUniversity: form.pgUniversity,
        pgYear: form.pgYear,
        ugCollege: form.ugCollege,
        mciNumber: form.mciCouncilNumber,
        mciState: form.mciCouncilState,
        asiNumber: form.asiMembershipNo,
      }

      const formDataObj = new FormData()
      formDataObj.append("data", JSON.stringify({
        applicationId: application.id,
        email: application.email,
        updates,
      }))

      // Append files if selected
      Object.entries(files).forEach(([key, file]) => {
        if (file) formDataObj.append(key, file)
      })

      const res = await fetch("/api/applications/resubmit", {
        method: "POST",
        body: formDataObj,
      })

      const json = await res.json()

      if (!res.ok || !json.status) {
        throw new Error(json.message || "Failed to resubmit application")
      }

      setSuccessMessage("Your application has been resubmitted for review. You will be notified once it has been reviewed.")
      setPhase("success")
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Something went wrong. Please try again."
      setErrorMessage(msg)
      setPhase("error")
    }
  }

  /* ---- Loading state ---- */
  if (phase === "loading") {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
        <p className="text-muted-foreground mt-4">Loading application...</p>
      </div>
    )
  }

  /* ---- Error state ---- */
  if (phase === "error") {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Card className="border-dashed">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-7 w-7 text-destructive" />
            </div>
            <p className="font-medium text-foreground">{errorMessage}</p>
            {application && (
              <p className="text-sm text-muted-foreground">
                Reference: {application.reference_number} &middot; Status: {statusLabel(application.status)}
              </p>
            )}
            <div className="flex items-center justify-center gap-3 pt-2">
              <a href={`/apply/status${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`}>
                <Button variant="outline" size="sm">Back to Status</Button>
              </a>
              {(phase === "error" && !application) && (
                <a href="/apply">
                  <Button size="sm">New Application</Button>
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ---- Success state ---- */
  if (phase === "success") {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <Card>
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle className="h-7 w-7 text-success" />
            </div>
            <h3 className="text-lg font-semibold">Application Resubmitted</h3>
            <p className="text-sm text-muted-foreground">{successMessage}</p>
            {application && (
              <p className="text-sm text-muted-foreground">
                Reference: <span className="font-mono font-medium">{application.reference_number}</span>
              </p>
            )}
            <div className="pt-2">
              <a href={`/apply/status?ref=${encodeURIComponent(ref)}`}>
                <Button size="sm">Track Application Status</Button>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  /* ---- Form state ---- */
  const isLM = application?.membership_type === "LM"

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Section 1: Header */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <FileEdit className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Edit & Resubmit Application</h2>
            <p className="text-muted-foreground text-sm flex items-center gap-2">
              <span className="font-mono">{application!.reference_number}</span>
              <Badge variant={statusBadgeVariant(application!.status)}>
                {statusLabel(application!.status)}
              </Badge>
            </p>
          </div>
        </div>
      </div>

      {/* Section 2: Admin Message */}
      {application!.review_notes && (
        <Card
          className={`border ${
            application!.status === "need_clarification"
              ? "bg-blue-50 border-blue-200"
              : "bg-amber-50 border-amber-200"
          }`}
        >
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <Info
                className={`h-5 w-5 mt-0.5 shrink-0 ${
                  application!.status === "need_clarification" ? "text-blue-600" : "text-amber-600"
                }`}
              />
              <div>
                <p
                  className={`text-sm font-bold mb-1 ${
                    application!.status === "need_clarification" ? "text-blue-800" : "text-amber-800"
                  }`}
                >
                  {application!.status === "need_clarification"
                    ? "Clarification Requested by Admin"
                    : "Resubmission Requested by Admin"}
                </p>
                <p
                  className={`text-sm ${
                    application!.status === "need_clarification" ? "text-blue-700" : "text-amber-700"
                  }`}
                >
                  {application!.review_notes}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section 3: Editable Form */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Personal Info */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Personal Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FieldSelect
                label="Salutation"
                name="salutation"
                value={form.salutation}
                options={SALUTATIONS}
                onChange={handleChange}
                required
              />
              <FieldInput
                label="First Name"
                name="firstName"
                value={form.firstName}
                onChange={handleChange}
                required
              />
              <FieldInput
                label="Middle Name"
                name="middleName"
                value={form.middleName}
                onChange={handleChange}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput
                label="Last Name"
                name="lastName"
                value={form.lastName}
                onChange={handleChange}
                required
              />
              <FieldInput
                label="Father's Name"
                name="fatherName"
                value={form.fatherName}
                onChange={handleChange}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FieldInput
                label="Date of Birth"
                name="dob"
                value={form.dob}
                onChange={handleChange}
                type="date"
                required
              />
              <FieldSelect
                label="Gender"
                name="gender"
                value={form.gender}
                options={GENDERS}
                onChange={handleChange}
                required
              />
              <FieldInput
                label="Phone"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                readOnly
              />
            </div>
            <div className="grid grid-cols-1">
              <FieldInput
                label="Email"
                name="email"
                value={form.email}
                onChange={handleChange}
                readOnly
                type="email"
              />
            </div>
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FieldInput
              label="Address Line 1"
              name="streetLine1"
              value={form.streetLine1}
              onChange={handleChange}
              required
            />
            <FieldInput
              label="Address Line 2"
              name="streetLine2"
              value={form.streetLine2}
              onChange={handleChange}
            />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <FieldInput
                label="City"
                name="city"
                value={form.city}
                onChange={handleChange}
                required
              />
              <FieldSelect
                label="State"
                name="state"
                value={form.state}
                options={INDIAN_STATES}
                onChange={handleChange}
                required
              />
              <FieldInput
                label="PIN Code"
                name="pin"
                value={form.pin}
                onChange={handleChange}
                required
                placeholder="6-digit PIN"
              />
            </div>
            <FieldInput
              label="Country"
              name="country"
              value={form.country}
              onChange={handleChange}
            />
          </CardContent>
        </Card>

        {/* Education */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Education</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput
                label="PG Degree"
                name="pgDegree"
                value={form.pgDegree}
                onChange={handleChange}
                placeholder="e.g. MS General Surgery"
              />
              <FieldInput
                label="PG College"
                name="pgCollege"
                value={form.pgCollege}
                onChange={handleChange}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput
                label="PG University"
                name="pgUniversity"
                value={form.pgUniversity}
                onChange={handleChange}
              />
              <FieldInput
                label="PG Year"
                name="pgYear"
                value={form.pgYear}
                onChange={handleChange}
                placeholder="e.g. 2010"
              />
            </div>
            <FieldInput
              label="UG College (MBBS)"
              name="ugCollege"
              value={form.ugCollege}
              onChange={handleChange}
            />
          </CardContent>
        </Card>

        {/* Medical Registration */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Medical Registration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldInput
                label="MCI/NMC Council Number"
                name="mciCouncilNumber"
                value={form.mciCouncilNumber}
                onChange={handleChange}
                required
              />
              <FieldSelect
                label="MCI State"
                name="mciCouncilState"
                value={form.mciCouncilState}
                options={INDIAN_STATES}
                onChange={handleChange}
              />
            </div>
            {isLM && (
              <FieldInput
                label="ASI Membership Number"
                name="asiMembershipNo"
                value={form.asiMembershipNo}
                onChange={handleChange}
              />
            )}
          </CardContent>
        </Card>

        {/* Documents */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">Documents</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Upload new files only if you need to replace the previously submitted documents.
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            {([
              { key: "photo", label: "Profile Photo" },
              { key: "pg_certificate", label: "PG Degree Certificate" },
              { key: "mci_certificate", label: "MCI / State Medical Council Certificate" },
            ] as const).map(({ key, label }) => {
              const existingDoc = application?.documents?.[key]
              const existingUrl = existingDoc?.url || (typeof existingDoc === "string" ? existingDoc : null)
              const selectedFile = files[key]

              return (
                <div key={key} className="space-y-2">
                  <Label className="text-sm font-medium">{label}</Label>

                  {existingUrl && !selectedFile && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
                      <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                      <span className="truncate">Currently uploaded: {getFileName(existingUrl as string)}</span>
                      <a
                        href={existingUrl as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto shrink-0"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-primary" />
                      </a>
                    </div>
                  )}

                  {selectedFile && (
                    <div className="flex items-center gap-2 text-sm bg-primary/5 rounded-md px-3 py-2">
                      <Upload className="h-4 w-4 text-primary shrink-0" />
                      <span className="truncate">{selectedFile.name}</span>
                      <button
                        type="button"
                        className="ml-auto text-xs text-destructive hover:underline shrink-0"
                        onClick={() => {
                          handleFileChange(key, null)
                          const input = fileInputRefs.current[key]
                          if (input) input.value = ""
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  )}

                  <div>
                    <input
                      ref={(el) => { fileInputRefs.current[key] = el }}
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null
                        handleFileChange(key, file)
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => fileInputRefs.current[key]?.click()}
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      {existingUrl || selectedFile ? "Replace File" : "Upload File"}
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>

        {/* Section 4: Submit */}
        <div className="flex items-center justify-between gap-4">
          <a href={`/apply/status?ref=${encodeURIComponent(ref)}`}>
            <Button type="button" variant="ghost" size="sm">
              Back to Status
            </Button>
          </a>
          <Button
            type="submit"
            disabled={phase === "submitting"}
            size="lg"
          >
            {phase === "submitting" ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resubmitting...
              </>
            ) : (
              "Resubmit Application"
            )}
          </Button>
        </div>
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Default export with Suspense wrapper                               */
/* ------------------------------------------------------------------ */

export default function ResubmitPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-3xl mx-auto py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground mt-4">Loading...</p>
        </div>
      }
    >
      <ResubmitContent />
    </Suspense>
  )
}
