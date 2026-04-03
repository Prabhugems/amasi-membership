"use client"

import { useState, useMemo, useRef, useCallback } from "react"
import { ChevronDown, ChevronRight, CheckCircle2, AlertCircle, CircleDot, Camera, User, MapPin, GraduationCap, ShieldCheck, Zap, Lock, FileText, Upload, ExternalLink, Loader2, Mail, Hash, CalendarDays, ImagePlus, Search, BookOpen, Award, Plus, Info, ArrowRight, CloudUpload, Eye, RefreshCw, FileImage, File as FileIcon, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { toast } from "sonner"
import type { ProfileFormData } from "@/lib/profile-mapper"
import { getMissingFields } from "@/lib/profile-mapper"
import { Autocomplete } from "@/components/ui/autocomplete"
import { MEDICAL_COLLEGES_INDIA } from "@/data/medical-colleges-india"
import { STATE_TO_ZONE } from "@/lib/membership-types"
import { EducationSection } from "@/components/profile/education-section"

const COUNTRIES = [
  "India", "Nepal", "Sri Lanka", "Bangladesh", "United States", "United Kingdom",
  "Canada", "Australia", "United Arab Emirates", "Saudi Arabia", "Singapore",
  "Malaysia", "Germany", "Other",
]

const COLLEGE_OPTIONS = MEDICAL_COLLEGES_INDIA.map(c => ({
  label: c.name,
  sublabel: `${c.state} — ${c.university}`,
  state: c.state,
  university: c.university,
}))

const ALL_DOCUMENT_TYPES: { key: keyof ProfileFormData; dbCol: string; label: string; forTypes?: string[] }[] = [
  { key: "profilePhoto", dbCol: "profile_photo", label: "Profile Photo" },
  { key: "mciCertificate", dbCol: "mci_certificate", label: "MCI Certificate" },
  { key: "pgDegreeCertificate", dbCol: "pg_degree_certificate", label: "PG Degree Certificate" },
  { key: "mbbsDegreeCertificate", dbCol: "mbbs_degree_certificate", label: "MBBS Degree Certificate", forTypes: ["LM"] },
  { key: "asiMemberCertificate", dbCol: "asi_member_certificate", label: "ASI Certificate", forTypes: ["LM"] },
  { key: "activeLicense", dbCol: "active_license", label: "Active License", forTypes: ["LM", "ILM"] },
  { key: "letterHod", dbCol: "letter_hod", label: "HOD Letter", forTypes: ["ACM"] },
]

const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar",
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli", "Daman and Diu", "Delhi",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand",
  "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra",
  "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal",
]

const PG_DEGREES = [
  "MS General Surgery", "MS Obstetrics & Gynaecology", "MS Ophthalmology", "MS Orthopaedics",
  "MS ENT", "MD General Medicine", "MD Anaesthesia", "MD Radiology", "MD Paediatrics",
  "MD Dermatology", "MD Psychiatry", "MD Pathology", "MD Microbiology",
  "MCh Surgical Oncology", "MCh Urology", "MCh Cardiothoracic Surgery",
  "MCh Neurosurgery", "MCh Plastic Surgery", "MCh Paediatric Surgery",
  "DNB General Surgery", "DNB Obstetrics & Gynaecology", "DNB Orthopaedics",
  "FRCS", "MRCS", "Other",
]

const SECTION_ICONS: Record<string, React.ReactNode> = {
  personal: <User className="h-4 w-4" />,
  address: <MapPin className="h-4 w-4" />,
  education: <GraduationCap className="h-4 w-4" />,
  registration: <ShieldCheck className="h-4 w-4" />,
  documents: <FileText className="h-4 w-4" />,
}

interface ProfileEditFormProps {
  data: ProfileFormData
  onChange: (updated: ProfileFormData) => void
  onSave: () => void
  onCancel: () => void
}

export function ProfileEditForm({ data, onChange, onSave, onCancel }: ProfileEditFormProps) {
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(["personal", "address", "education", "registration", "documents"]))
  const [quickFill, setQuickFill] = useState(false)
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadErrorDoc, setUploadErrorDoc] = useState<string | null>(null)
  const [recentlyUploaded, setRecentlyUploaded] = useState<string | null>(null)
  const [dragOverDoc, setDragOverDoc] = useState<string | null>(null)
  const [pinLookupStatus, setPinLookupStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [pinLookupArea, setPinLookupArea] = useState("")
  const pinAbortRef = useRef<AbortController | null>(null)

  const handlePinLookup = useCallback(async (pin: string) => {
    onChange({ ...data, postalCode: pin })
    if (!/^\d{6}$/.test(pin)) {
      setPinLookupStatus("idle")
      setPinLookupArea("")
      return
    }
    pinAbortRef.current?.abort()
    const controller = new AbortController()
    pinAbortRef.current = controller
    setPinLookupStatus("loading")
    setPinLookupArea("")
    try {
      const res = await fetch(`/api/pincode?pin=${pin}`, { signal: controller.signal })
      const result = await res.json()
      if (result.status && result.city) {
        const zone = STATE_TO_ZONE[result.state] || ""
        onChange({ ...data, postalCode: pin, city: result.city, state: result.state, zone, country: "India" })
        setPinLookupArea(result.area || "")
        setPinLookupStatus("success")
      } else {
        setPinLookupStatus("error")
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") return
      setPinLookupStatus("error")
    }
  }, [data, onChange])


  // Filter documents by membership type — ALM only needs photo, MCI, PG degree
  const DOCUMENT_TYPES = useMemo(() => ALL_DOCUMENT_TYPES.filter(d => {
    if (!d.forTypes) return true // no restriction — show for all
    return d.forTypes.includes(data.membership_type) || !!data[d.key] // show if type matches OR already uploaded
  }), [data.membership_type])

  const docsUploaded = useMemo(() => DOCUMENT_TYPES.filter(d => !!data[d.key]).length, [DOCUMENT_TYPES, data])
  const docsTotal = DOCUMENT_TYPES.length
  const allDocsComplete = docsUploaded === docsTotal

  const missingFields = useMemo(() => getMissingFields(data), [data])

  const update = (field: keyof ProfileFormData, value: string) => {
    onChange({ ...data, [field]: value })
  }

  const toggleSection = (section: string) => {
    setOpenSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) next.delete(section)
      else next.add(section)
      return next
    })
  }

  const handleDocUpload = async (file: File, docType: string, formKey: keyof ProfileFormData) => {
    if (!data.id) {
      toast.error("Member ID not found")
      return
    }
    // Validate file size (5 MB)
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File too large. Maximum size is 5 MB.")
      setUploadErrorDoc(docType)
      return
    }
    setUploadingDoc(docType)
    setUploadError(null)
    setUploadErrorDoc(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("memberId", data.id)
      fd.append("docType", docType)

      const res = await fetch("/api/members/upload", { method: "POST", body: fd })
      const result = await res.json()

      if (result.status && result.url) {
        onChange({ ...data, [formKey]: result.url })
        toast.success(`${DOCUMENT_TYPES.find(d => d.dbCol === docType)?.label || "Document"} uploaded`)
        setRecentlyUploaded(docType)
        setTimeout(() => setRecentlyUploaded(null), 2000)
      } else {
        setUploadError(result.message || "Upload failed")
        setUploadErrorDoc(docType)
        toast.error(result.message || "Upload failed")
      }
    } catch {
      setUploadError("Upload failed. Please try again.")
      setUploadErrorDoc(docType)
      toast.error("Upload failed. Please try again.")
    } finally {
      setUploadingDoc(null)
    }
  }

  const handleDrop = (e: React.DragEvent, docType: string, formKey: keyof ProfileFormData) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverDoc(null)
    const file = e.dataTransfer.files?.[0]
    if (file) handleDocUpload(file, docType, formKey)
  }

  const isImageUrl = (url: string) => {
    return /\.(jpg|jpeg|png|gif|webp)/i.test(url)
  }

  // Section completeness checks
  const sectionStatus = useMemo(() => {
    const personal = !!(data.firstName && data.dob && data.gender)
    const address = !!(data.city && data.state)
    const education = !!(data.eduPostgradDegree)
    const registration = !!(data.mciCouncilNumber)
    return { personal, address, education, registration }
  }, [data])

  const completionPercent = useMemo(() => {
    const fields = [
      data.firstName, data.dob, data.gender, data.fatherName, data.nationality,
      data.streetLine1, data.city, data.state, data.postalCode, data.country,
      data.eduUndergradCollege, data.eduPostgradDegree, data.eduPostgradCollege,
      data.mciCouncilNumber, data.mciCouncilState,
    ]
    const filled = fields.filter(Boolean).length
    return Math.round((filled / fields.length) * 100)
  }, [data])

  const completionColor = completionPercent === 100
    ? "bg-green-500"
    : completionPercent >= 70
      ? "bg-primary"
      : "bg-amber-500"

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Edit Profile</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            AMASI #{data.amasi_number} &middot; {data.email}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSave}>Review Changes</Button>
        </div>
      </div>

      {/* Completion bar + quick fill toggle */}
      <Card>
        <CardContent className="py-5 px-6">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium">Profile Completeness</span>
            <span className={`text-lg font-bold tabular-nums ${completionPercent === 100 ? "text-green-600" : completionPercent >= 70 ? "text-primary" : "text-amber-600"}`}>
              {completionPercent}%
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all duration-500 ease-out ${completionColor}`}
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          {missingFields.length > 0 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t">
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground">Missing:</span>{" "}
                {missingFields.join(", ")}
              </p>
              <Button
                variant={quickFill ? "secondary" : "outline"}
                size="sm"
                className="text-xs shrink-0 ml-4 gap-1.5"
                onClick={() => setQuickFill(!quickFill)}
              >
                <Zap className="h-3 w-3" />
                {quickFill ? "Show All Fields" : "Quick Fill Missing"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Personal Info */}
      <Section
        title="Personal Information"
        id="personal"
        complete={sectionStatus.personal}
        open={openSections.has("personal")}
        onToggle={toggleSection}
        show={!quickFill || !sectionStatus.personal}
        collapsedSummary={
          <div className="flex items-center gap-3 px-5 pb-4 flex-wrap">
            {data.profilePhoto ? (
              <img src={data.profilePhoto} alt="" className="h-8 w-8 rounded-full object-cover border border-border" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground">
                {data.firstName?.charAt(0) || "?"}
              </div>
            )}
            <span className="text-sm font-medium text-foreground">
              {data.salutation} {data.firstName} {data.lastName}
            </span>
            {data.dob && (
              <Badge variant="secondary" className="text-[11px] font-normal gap-1">
                <CalendarDays className="h-3 w-3" />
                {data.dob}
              </Badge>
            )}
            {data.gender && (
              <Badge variant="outline" className="text-[11px] font-normal">
                {data.gender}
              </Badge>
            )}
          </div>
        }
      >
        {/* Profile Photo — centered, always-visible upload */}
        <div className="flex flex-col items-center mb-6">
          <div className="relative">
            {data.profilePhoto ? (
              <img
                src={data.profilePhoto}
                alt="Profile"
                className="h-28 w-28 rounded-full object-cover border-4 border-primary/20 shadow-md"
              />
            ) : (
              <div className="h-28 w-28 rounded-full bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center border-4 border-primary/20 shadow-md">
                <Camera className="h-10 w-10 text-primary/40" />
              </div>
            )}
            {uploadingDoc === "profile_photo" && (
              <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                <Loader2 className="h-6 w-6 text-white animate-spin" />
              </div>
            )}
          </div>
          <label className="mt-3 cursor-pointer">
            <Button variant="outline" size="sm" className="gap-2 pointer-events-none" tabIndex={-1} asChild>
              <span>
                <ImagePlus className="h-4 w-4" />
                {data.profilePhoto ? "Change Photo" : "Upload Photo"}
              </span>
            </Button>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (!file) return
                handleDocUpload(file, "profile_photo", "profilePhoto")
              }}
            />
          </label>
          <p className="text-[11px] text-muted-foreground mt-1.5">JPG or PNG, max 2 MB</p>
        </div>

        {/* Mini Profile Card — Name + Identity */}
        <div className="rounded-xl border border-border/60 bg-gradient-to-r from-primary/[0.04] to-transparent p-5 mb-6">
          <div className="flex items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Member Profile</span>
              </div>
              <p className="text-xl font-bold tracking-tight truncate">
                {data.salutation} {data.firstName} {data.middleName} {data.lastName}
              </p>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Hash className="h-3 w-3" />
                  AMASI {data.amasi_number}
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Mail className="h-3 w-3" />
                  {data.email}
                </span>
              </div>
            </div>
            <Badge variant={data.membership_type === "LM" ? "default" : "secondary"} className="shrink-0 text-[11px]">
              {data.membership_type}
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-3 border-t border-border/40 pt-2.5">
            Contact the admin to update your name
          </p>
        </div>

        {/* Divider label */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-px flex-1 bg-border/60" />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Details</span>
          <div className="h-px flex-1 bg-border/60" />
        </div>

        {/* DOB with age calculation + Father's Name */}
        <div className="grid gap-4 sm:grid-cols-2 mb-4">
          {(!quickFill || !data.dob) && (
            <div>
              <Label className="text-sm font-medium">
                Date of Birth <span className="text-destructive">*</span>
              </Label>
              <div className="flex items-center gap-3 mt-1.5">
                <Input
                  type="date"
                  value={data.dob}
                  onChange={(e) => update("dob", e.target.value)}
                  className={`flex-1 ${!data.dob ? "border-amber-400 bg-amber-50/50 focus-visible:ring-amber-400" : ""}`}
                />
                {data.dob && (() => {
                  const birth = new Date(data.dob)
                  const today = new Date()
                  let age = today.getFullYear() - birth.getFullYear()
                  const m = today.getMonth() - birth.getMonth()
                  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
                  return (
                    <span className="text-sm font-medium text-muted-foreground whitespace-nowrap bg-muted px-3 py-1.5 rounded-md">
                      Age: {age} yrs
                    </span>
                  )
                })()}
              </div>
            </div>
          )}

          {!quickFill && (
            <Field label="Father's Name" value={data.fatherName} onChange={(v) => update("fatherName", v)}
              placeholder="e.g. Rajesh Kumar"
            />
          )}
        </div>

        {/* Gender toggle buttons */}
        {(!quickFill || !data.gender) && (
          <div className="mb-4">
            <Label className="text-sm font-medium">
              Gender <span className="text-destructive">*</span>
            </Label>
            <div className="flex gap-2 mt-1.5">
              {["Male", "Female", "Others"].map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => update("gender", g)}
                  className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium border transition-all duration-150 ${
                    data.gender === g
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Nationality */}
        {!quickFill && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Nationality" value={data.nationality} onChange={(v) => update("nationality", v)}
              options={["Indian", "Nepalese", "Sri Lankan", "Bangladeshi", "Other"]}
            />
          </div>
        )}
      </Section>

      {/* Address */}
      <Section
        title="Address"
        id="address"
        complete={sectionStatus.address}
        open={openSections.has("address")}
        onToggle={toggleSection}
        show={!quickFill || !sectionStatus.address}
        summary={data.city && data.state ? `${data.city}, ${data.state}${data.postalCode ? ` ${data.postalCode}` : ""}` : undefined}
      >
        <div className="space-y-5">
          {/* PIN Code - primary input with auto-fill */}
          <div className="rounded-xl border border-border/60 bg-gradient-to-r from-primary/5 to-transparent p-4">
            <Label className="text-sm font-semibold flex items-center gap-2 mb-1">
              <Search className="h-3.5 w-3.5 text-primary" />
              Enter PIN Code to auto-fill city &amp; state
            </Label>
            <p className="text-xs text-muted-foreground mb-3">Type a 6-digit Indian PIN code for instant lookup</p>
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-[200px]">
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={data.postalCode}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, "").slice(0, 6)
                    handlePinLookup(v)
                  }}
                  placeholder="e.g. 641045"
                  maxLength={6}
                  className={`text-lg font-mono tracking-widest h-11 pr-10 ${
                    pinLookupStatus === "success" ? "border-green-500 bg-green-50/50 focus-visible:ring-green-500" :
                    pinLookupStatus === "error" ? "border-red-400 bg-red-50/50 focus-visible:ring-red-400" : ""
                  }`}
                />
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  {pinLookupStatus === "loading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {pinLookupStatus === "success" && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                  {pinLookupStatus === "error" && <AlertCircle className="h-4 w-4 text-red-400" />}
                </div>
              </div>
              {pinLookupStatus === "success" && pinLookupArea && (
                <Badge variant="secondary" className="text-xs font-normal py-1 px-2.5 bg-green-100 text-green-700 border-green-200">
                  {pinLookupArea}
                </Badge>
              )}
              {pinLookupStatus === "error" && (
                <span className="text-xs text-red-500">PIN not found. Enter city &amp; state manually.</span>
              )}
            </div>
          </div>

          {/* City + State + Zone in one row */}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" value={data.city} onChange={(v) => update("city", v)} required
              placeholder="e.g. Coimbatore"
              show={!quickFill || !data.city}
            />
            <Select label="State" value={data.state} onChange={(v) => {
              update("state", v)
              const zone = STATE_TO_ZONE[v] || ""
              if (zone) onChange({ ...data, state: v, zone })
            }} required
              options={INDIAN_STATES} searchable
              show={!quickFill || !data.state}
            />
            {data.zone && (
              <div>
                <Label className="text-sm font-medium">Zone</Label>
                <div className="mt-1.5 flex items-center h-9">
                  <Badge variant="outline" className="text-xs font-medium py-1 px-2.5">
                    {data.zone}
                  </Badge>
                </div>
              </div>
            )}
          </div>

          {/* Street Address - full width */}
          {(!quickFill) && (
            <div className="grid gap-4">
              <Field label="Street Address Line 1" value={data.streetLine1} onChange={(v) => update("streetLine1", v)}
                placeholder="e.g. 42, MG Road"
              />
              <Field label="Street Address Line 2" value={data.streetLine2} onChange={(v) => update("streetLine2", v)}
                placeholder="e.g. Near City Hospital, Peelamedu"
              />
            </div>
          )}

          {/* Country */}
          {(!quickFill) && (
            <div className="max-w-[250px]">
              <Select label="Country" value={data.country || "India"} onChange={(v) => update("country", v)}
                options={COUNTRIES}
              />
            </div>
          )}
        </div>
      </Section>

      {/* Education */}
      <Section
        title="Education"
        id="education"
        complete={sectionStatus.education}
        open={openSections.has("education")}
        onToggle={toggleSection}
        show={!quickFill || !sectionStatus.education}
      >
        <EducationSection data={data} update={update} onChange={onChange} quickFill={quickFill} />
      </Section>

      {/* Medical Registration */}
      <Section
        title="Medical Registration"
        id="registration"
        complete={sectionStatus.registration}
        open={openSections.has("registration")}
        onToggle={toggleSection}
        show={!quickFill || !sectionStatus.registration}
        collapsedSummary={
          <>
            {data.mciCouncilNumber && (
              <Badge variant="secondary" className="text-[11px] px-2 py-0.5 gap-1 font-normal">
                MCI: {data.mciCouncilNumber}
                {data.mciCertificate ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : null}
              </Badge>
            )}
            {data.asiMembershipNo && (
              <Badge variant="secondary" className="text-[11px] px-2 py-0.5 gap-1 font-normal">
                ASI: {data.asiMembershipNo}
                {data.asiMemberCertificate ? <CheckCircle2 className="h-3 w-3 text-green-500" /> : null}
              </Badge>
            )}
            {data.imrRegNo && (
              <Badge variant="secondary" className="text-[11px] px-2 py-0.5 font-normal">
                IMR: {data.imrRegNo}
              </Badge>
            )}
          </>
        }
      >
        <div className="space-y-6">
          {/* MCI Registration Group */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">MCI / State Medical Council</h4>
            <div className={`rounded-xl border p-4 mb-4 ${data.mciCertificate ? "border-green-200 bg-green-50/50" : "border-blue-200 bg-blue-50/30"}`}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${data.mciCertificate ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600"}`}>
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                      MCI/Council Number <Lock className="h-3 w-3" />
                    </span>
                    <p className="text-lg font-bold tracking-wide tabular-nums mt-0.5">{data.mciCouncilNumber || "Not set"}</p>
                  </div>
                </div>
                <div className="shrink-0">
                  {data.mciCertificate ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100 gap-1">
                      <CheckCircle2 className="h-3 w-3" /> Certificate Verified
                    </Badge>
                  ) : data.mciCouncilNumber ? (
                    <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 gap-1">
                      <Info className="h-3 w-3" /> On record
                    </Badge>
                  ) : null}
                </div>
              </div>
              {!data.mciCertificate && data.mciCouncilNumber && (
                <button type="button" onClick={() => { const el = document.getElementById("documents"); if (el) { if (!openSections.has("documents")) toggleSection("documents"); setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100) } }} className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors">
                  Upload certificate to verify <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Select label="MCI Council State" value={data.mciCouncilState} onChange={(v) => update("mciCouncilState", v)} options={INDIAN_STATES} searchable show={!quickFill || !data.mciCouncilState} />
              <div className={!quickFill ? "" : "hidden"}>
                <Label className="text-sm font-medium flex items-center gap-1.5">
                  IMR Registration No
                  <span className="relative group/tooltip">
                    <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 px-2.5 py-1.5 text-xs text-white bg-gray-900 rounded-lg opacity-0 group-hover/tooltip:opacity-100 pointer-events-none transition-opacity z-50 text-center">Indian Medical Register number from NMC</span>
                  </span>
                </Label>
                <Input value={data.imrRegNo} onChange={(e) => update("imrRegNo", e.target.value)} placeholder="e.g. 123456" className="mt-1.5" />
              </div>
            </div>
          </div>

          {/* ASI Membership Group */}
          {(data.membership_type === "LM" || data.asiMembershipNo) && (
            <div className="border-t pt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">ASI Membership</h4>
              {data.asiMembershipNo && (
                <div className={`rounded-xl border p-4 mb-4 ${data.asiMemberCertificate ? "border-green-200 bg-green-50/50" : "border-blue-200 bg-blue-50/30"}`}>
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex items-center justify-center h-10 w-10 rounded-lg shrink-0 ${data.asiMemberCertificate ? "bg-green-100 text-green-600" : "bg-blue-100 text-blue-600"}`}>
                        <Award className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">ASI Membership No</span>
                        <p className="text-lg font-bold tracking-wide mt-0.5">{data.asiMembershipNo}</p>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {data.asiMemberCertificate ? (
                        <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100 gap-1">
                          <CheckCircle2 className="h-3 w-3" /> Certificate Verified
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50 gap-1">
                          <Info className="h-3 w-3" /> On record
                        </Badge>
                      )}
                    </div>
                  </div>
                  {!data.asiMemberCertificate && (
                    <button type="button" onClick={() => { const el = document.getElementById("documents"); if (el) { if (!openSections.has("documents")) toggleSection("documents"); setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 100) } }} className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 transition-colors">
                      Upload certificate to verify <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="ASI Membership No" value={data.asiMembershipNo} onChange={(v) => update("asiMembershipNo", v)} placeholder="e.g. LM-1234" show={!quickFill} />
                <Select label="ASI State" value={data.asiState} onChange={(v) => update("asiState", v)} options={INDIAN_STATES} searchable show={!quickFill} />
              </div>
            </div>
          )}
        </div>
      </Section>

      {/* Documents */}
      <Section
        title="Documents"
        id="documents"
        complete={allDocsComplete}
        open={openSections.has("documents")}
        onToggle={toggleSection}
        show={true}
        collapsedSummary={
          allDocsComplete
            ? <span className="text-xs font-medium text-green-600">{docsTotal}/{docsTotal} documents uploaded</span>
            : <span className="text-xs font-medium text-amber-600">{docsUploaded}/{docsTotal} documents &mdash; {docsTotal - docsUploaded} missing</span>
        }
      >
        {/* Progress header */}
        <div className="flex items-center gap-3 mb-5 p-3 rounded-lg bg-muted/40 border border-border/40">
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium">
                {allDocsComplete
                  ? <span className="text-green-600">All documents complete</span>
                  : <>{docsUploaded} of {docsTotal} documents uploaded</>
                }
              </span>
              {allDocsComplete && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            </div>
            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
              <div
                className={`h-2 rounded-full transition-all duration-500 ease-out ${allDocsComplete ? "bg-green-500" : "bg-primary"}`}
                style={{ width: `${docsTotal > 0 ? (docsUploaded / docsTotal) * 100 : 0}%` }}
              />
            </div>
          </div>
        </div>

        {/* Document cards grid */}
        <div className="grid gap-3 sm:grid-cols-2">
          {DOCUMENT_TYPES.map(({ key, dbCol, label, forTypes }) => {
            const url = data[key] as string | null
            const isUploading = uploadingDoc === dbCol
            const hasError = uploadErrorDoc === dbCol && !!uploadError
            const justUploaded = recentlyUploaded === dbCol
            const isDragOver = dragOverDoc === dbCol
            const isRequired = !forTypes
            const isImage = url ? isImageUrl(url) : false

            if (url) {
              return (
                <div
                  key={dbCol}
                  className={`relative rounded-xl border p-4 transition-all duration-500 ${
                    justUploaded
                      ? "border-green-400 bg-green-50/80 shadow-sm shadow-green-100 ring-1 ring-green-200"
                      : "border-green-200 bg-green-50/50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    {isImage ? (
                      <img
                        src={url}
                        alt={label}
                        className="h-10 w-10 rounded-lg object-cover border border-green-200 shrink-0"
                      />
                    ) : (
                      <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center shrink-0">
                        <FileIcon className="h-5 w-5 text-green-600" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-green-900">{label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                        <span className="text-xs text-green-600 font-medium">Uploaded</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 hover:text-green-900 bg-green-100 hover:bg-green-200 px-2.5 py-1.5 rounded-md transition-colors"
                    >
                      <Eye className="h-3 w-3" /> View
                    </a>
                    <label className="cursor-pointer">
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 hover:text-green-900 bg-green-100 hover:bg-green-200 px-2.5 py-1.5 rounded-md transition-colors">
                        {isUploading ? (
                          <><Loader2 className="h-3 w-3 animate-spin" /> Uploading...</>
                        ) : (
                          <><RefreshCw className="h-3 w-3" /> Replace</>
                        )}
                      </span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        className="hidden"
                        disabled={isUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          handleDocUpload(file, dbCol, key)
                          e.target.value = ""
                        }}
                      />
                    </label>
                  </div>
                  {justUploaded && (
                    <div className="absolute inset-0 rounded-xl pointer-events-none flex items-center justify-center">
                      <div className="animate-ping absolute h-6 w-6 rounded-full bg-green-400 opacity-20" />
                    </div>
                  )}
                </div>
              )
            }

            return (
              <label
                key={dbCol}
                className={`relative rounded-xl border-2 border-dashed p-4 transition-all duration-200 cursor-pointer group ${
                  hasError
                    ? "border-red-300 bg-red-50/50"
                    : isDragOver
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-border/60 bg-muted/20 hover:border-primary/40 hover:bg-muted/40"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOverDoc(dbCol) }}
                onDragLeave={() => setDragOverDoc(null)}
                onDrop={(e) => handleDrop(e, dbCol, key)}
              >
                <div className="flex items-start gap-3">
                  <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                    isDragOver ? "bg-primary/10" : "bg-muted/60"
                  }`}>
                    <CloudUpload className={`h-5 w-5 transition-colors ${isDragOver ? "text-primary" : "text-muted-foreground/50"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold">{label}</p>
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 ${
                          isRequired
                            ? "text-amber-600 border-amber-300 bg-amber-50"
                            : "text-muted-foreground border-border bg-muted/50"
                        }`}
                      >
                        {isRequired ? "Required" : "Optional"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {isUploading ? (
                        <span className="flex items-center gap-1.5 text-primary">
                          <Loader2 className="h-3 w-3 animate-spin" /> Uploading...
                        </span>
                      ) : (
                        "Click to upload or drag & drop"
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground/70 mt-0.5">JPG, PNG, PDF (max 5 MB)</p>
                  </div>
                </div>
                {!isUploading && (
                  <div className="mt-3 flex items-center justify-center py-1.5 rounded-md bg-muted/50 group-hover:bg-primary/10 transition-colors">
                    <Upload className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary mr-1.5 transition-colors" />
                    <span className="text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">Upload File</span>
                  </div>
                )}
                {isUploading && (
                  <div className="mt-3">
                    <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div className="h-1.5 rounded-full bg-primary animate-pulse w-2/3" />
                    </div>
                  </div>
                )}
                {hasError && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    <span>{uploadError}</span>
                    <button
                      type="button"
                      className="ml-auto p-0.5 hover:bg-red-100 rounded"
                      onClick={(e) => { e.preventDefault(); setUploadError(null); setUploadErrorDoc(null) }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <input
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  disabled={isUploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return
                    handleDocUpload(file, dbCol, key)
                    e.target.value = ""
                  }}
                />
              </label>
            )
          })}
        </div>
      </Section>

      {/* Bottom actions */}
      <div className="flex items-center justify-between pt-4 border-t">
        <p className="text-xs text-muted-foreground hidden sm:block">
          Changes are saved only after review and OTP verification.
        </p>
        <div className="flex gap-3 ml-auto">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={onSave} size="lg" className="font-semibold">
            Review Changes
          </Button>
        </div>
      </div>
    </div>
  )
}

// --- Sub-components ---

function Section({ title, id, complete, open, onToggle, children, show = true, summary, collapsedSummary }: {
  title: string
  id: string
  complete: boolean
  open: boolean
  onToggle: (id: string) => void
  children: React.ReactNode
  show?: boolean
  summary?: string
  collapsedSummary?: React.ReactNode
}) {
  if (!show) return null
  return (
    <Card className={open ? "overflow-visible" : "overflow-hidden"} id={id}>
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-5 py-4 text-left font-medium hover:bg-accent/50 transition-colors"
      >
        <span className="flex items-center gap-3">
          <span className={`flex items-center justify-center h-8 w-8 rounded-lg ${complete ? "bg-green-100 text-green-600" : "bg-amber-100 text-amber-600"}`}>
            {SECTION_ICONS[id] || <CircleDot className="h-4 w-4" />}
          </span>
          <span className="flex flex-col gap-1">
            <span className="flex items-center gap-2.5">
              <span className="text-base">{title}</span>
              {complete ? (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              ) : (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-amber-600 border-amber-300 bg-amber-50">
                  Incomplete
                </Badge>
              )}
            </span>
            {!open && collapsedSummary && (
              <span className="flex items-center gap-1.5 flex-wrap">
                {collapsedSummary}
              </span>
            )}
            {!open && !collapsedSummary && summary && (
              <Badge variant="secondary" className="text-xs font-normal py-0.5 px-2 max-w-[280px] truncate">
                {summary}
              </Badge>
            )}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 shrink-0 ${open ? "rotate-0" : "-rotate-90"}`} />
      </button>
      <div
        className={`transition-all duration-200 ease-in-out ${open ? "opacity-100 overflow-visible" : "opacity-0 h-0 overflow-hidden"}`}
      >
        {open && <CardContent className="pt-0 pb-5 px-5 overflow-visible">{children}</CardContent>}
      </div>
    </Card>
  )
}

function Field({ label, value, onChange, type = "text", required, placeholder, className, maxLength, show = true }: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
  placeholder?: string
  className?: string
  maxLength?: number
  show?: boolean
}) {
  if (!show) return null
  const isEmpty = required && !value
  return (
    <div className={className}>
      <Label className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className={`mt-1.5 ${isEmpty ? "border-amber-400 bg-amber-50/50 focus-visible:ring-amber-400" : ""}`}
      />
    </div>
  )
}

function Select({ label, value, onChange, options, required, searchable, allowCustom, show = true }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
  required?: boolean
  searchable?: boolean
  allowCustom?: boolean
  show?: boolean
}) {
  if (!show) return null
  const isEmpty = required && !value
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)

  const filtered = searchable && search
    ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase()))
    : options

  const isCustomValue = value && !options.includes(value)

  return (
    <div className={`relative ${open ? "z-[60]" : ""}`}>
      <Label className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {searchable ? (
        <div className="relative">
          <Input
            value={open ? search : value}
            onChange={(e) => {
              setSearch(e.target.value)
              if (!open) setOpen(true)
            }}
            onFocus={() => {
              setOpen(true)
              setSearch("")
            }}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className={`mt-1.5 ${isEmpty ? "border-amber-400 bg-amber-50/50 focus-visible:ring-amber-400" : ""}`}
          />
          {value && !open && (
            <CheckCircle2 className="absolute right-3 top-[calc(50%+3px)] h-3.5 w-3.5 text-green-500" />
          )}
          {open && (
            <div className="absolute z-[60] mt-1 w-full max-h-52 overflow-auto rounded-lg border bg-popover shadow-lg ring-1 ring-black/5">
              {filtered.length === 0 && (
                <p className="px-3 py-2.5 text-sm text-muted-foreground">No results found</p>
              )}
              {filtered.map((opt) => (
                <button
                  key={opt}
                  type="button"
                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors flex items-center gap-2 ${opt === value ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent"}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(opt)
                    setSearch("")
                    setOpen(false)
                  }}
                >
                  {opt === value && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <span>{opt}</span>
                </button>
              ))}
              {allowCustom && search && !filtered.includes(search) && (
                <button
                  type="button"
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors text-primary border-t font-medium"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(search)
                    setSearch("")
                    setOpen(false)
                  }}
                >
                  Use &ldquo;{search}&rdquo;
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1.5 ${isEmpty ? "border-amber-400 bg-amber-50/50" : "border-input"}`}
        >
          <option value="">Select...</option>
          {isCustomValue && <option value={value}>{value}</option>}
          {options.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      )}
    </div>
  )
}
