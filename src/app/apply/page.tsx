"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Upload, FileCheck, Sparkles, CheckCircle, AlertCircle, Loader2,
  ArrowRight, ArrowLeft, Send, Shield, Award, Clock, Users, Star,
  ChevronRight, ChevronDown, X, Eye, GraduationCap, Stethoscope, Copy, Check,
  ExternalLink, FileText, ClipboardCheck, Info,
} from "lucide-react"
import { toast } from "sonner"
import {
  MEMBERSHIP_TYPES, INDIAN_STATES, STATE_TO_ZONE,
  calculateFee, getMembershipType, DOC_LABELS, INITIAL_FORM_DATA,
} from "@/lib/membership-types"
import type { ApplicationFormData, MembershipType, DocType, OCRVerification } from "@/lib/membership-types"
import { applyExtractions } from "@/lib/ai-extract"
import type { ExtractionResult } from "@/lib/ai-extract"
import { validatePersonalDetails, validateEducation, validateRegistration } from "@/lib/validators"
import { detectFace, preloadFaceDetection } from "@/lib/face-detect"
import type { MemberData } from "@/lib/api"
import { Autocomplete } from "@/components/ui/autocomplete"
import { MEDICAL_COLLEGES_INDIA } from "@/data/medical-colleges-india"
import { generateRefNumber, FIELD_HELP } from "@/lib/application-utils"
import { FieldHelp } from "@/components/ui/field-help"
const UPLOAD_TIPS: Record<string, { dos: string[]; donts: string[]; aiReads: string[] }> = {
  mci_certificate: {
    dos: ["Upload your MCI/State Medical Council registration certificate — not a degree or marksheet"],
    donts: ["Don't upload a degree certificate or admission letter here"],
    aiReads: ["Name", "Reg number", "Council", "State"],
  },
  pg_degree_certificate: {
    dos: ["Upload your PG degree certificate (MS/MD/MCh/DNB) — not marksheet"],
    donts: ["Don't upload MBBS degree here — this slot is for your postgraduate degree only"],
    aiReads: ["Degree", "Specialisation", "University", "Year"],
  },
  asi_member_certificate: {
    dos: ["Upload current-year ASI membership certificate or PDF from the ASI portal"],
    donts: ["Don't upload a payment receipt or expired certificate"],
    aiReads: ["Membership ID", "Year", "Category"],
  },
  mbbs_degree_certificate: {
    dos: ["Upload your MBBS degree or provisional certificate"],
    donts: ["Don't upload marksheets or admission letters"],
    aiReads: ["Degree", "University", "Year"],
  },
  letter_hod: {
    dos: ["Letter on institutional letterhead, signed by HOD, dated within last 6 months"],
    donts: ["Don't upload unsigned or undated letters"],
    aiReads: ["Name", "Department", "Institution", "Date"],
  },
  active_license: {
    dos: ["Upload your current valid practice license"],
    donts: ["Don't upload an expired license"],
    aiReads: ["License number", "Validity", "Country"],
  },
  profile: {
    dos: ["Recent passport-size photo, plain background, face clearly visible"],
    donts: ["No sunglasses, filters, or group photos"],
    aiReads: ["Face detection"],
  },
}
import { ProgressBar } from "@/components/apply/progress-bar"

const COLLEGE_OPTIONS = MEDICAL_COLLEGES_INDIA.map(c => ({
  label: c.name,
  sublabel: `${c.state} — ${c.university}`,
  state: c.state,
  university: c.university,
}))

// Stable form field components — defined OUTSIDE the main component to prevent focus loss on re-render
function StableFieldInput({ field, label, required, value, error, placeholder, helpText, isFilled, onChange }: {
  field: string; label: string; required?: boolean; value: string; error?: string; placeholder?: string; helpText?: string; isFilled?: boolean; onChange: (field: string, value: string) => void
}) {
  return (
    <div>
      <Label className="text-xs flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
        {isFilled && <CheckCircle className="h-3 w-3 text-green-500" />}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        placeholder={placeholder || ""}
        className={error ? "border-destructive bg-destructive/5" : isFilled ? "border-green-300" : ""}
      />
      {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
    </div>
  )
}

function StableSelectInput({ field, label, options, required, value, error, isFilled, onChange }: {
  field: string; label: string; options: readonly string[]; required?: boolean; value: string; error?: string; isFilled?: boolean; onChange: (field: string, value: string) => void
}) {
  // Detect year fields — use a compact number input instead of a 50-option dropdown
  const isYearField = options.length > 10 && options.every(o => /^\d{4}$/.test(o))

  return (
    <div>
      <Label className="text-xs flex items-center gap-1">
        {label}
        {required && <span className="text-destructive">*</span>}
        {isFilled && <CheckCircle className="h-3 w-3 text-green-500" />}
      </Label>
      {isYearField ? (
        <input
          type="number"
          min={Math.min(...options.map(Number))}
          max={Math.max(...options.map(Number))}
          className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${error ? "border-destructive bg-destructive/5" : isFilled ? "border-green-300" : "border-input"}`}
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
          onBlur={(e) => {
            const v = Number(e.target.value)
            const min = Math.min(...options.map(Number))
            const max = Math.max(...options.map(Number))
            if (e.target.value && (v < min || v > max)) onChange(field, String(Math.min(Math.max(v, min), max)))
          }}
          placeholder="e.g. 2010"
        />
      ) : (
        <select
          className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${error ? "border-destructive bg-destructive/5" : isFilled ? "border-green-300" : "border-input"}`}
          value={value}
          onChange={(e) => onChange(field, e.target.value)}
        >
          <option value="">Select...</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {error && <p className="text-xs text-destructive mt-0.5">{error}</p>}
    </div>
  )
}

type Phase = "check" | "existing" | "landing" | "verify" | "upload" | "review" | "confirm" | "success"
type UploadEntry = {
  file: File
  preview: string
  status: "processing" | "extracted" | "uploaded" | "rejected" | "blocked"
  extracted: Record<string, any>
  eligibility?: { eligible: boolean; reason: string } | null
  message?: string
}

// Auto-capitalize first letter of each word
function autoCapitalize(str: string): string {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

// Calculate age from DOB
function calcAge(dob: string): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age--
  return age > 0 && age < 120 ? age : null
}

// Year options for dropdowns
const YEAR_OPTIONS = Array.from({ length: 50 }, (_, i) => String(new Date().getFullYear() - i))

export default function ApplyPage() {
  // Restore form data from localStorage on mount
  const [phase, setPhase] = useState<Phase>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("amasi_apply_phase")
      if (saved && ["check", "landing", "upload", "review"].includes(saved)) return saved as Phase
    }
    return "check"
  })
  const [checkQuery, setCheckQuery] = useState("")
  const [checking, setChecking] = useState(false)
  const [existingMember, setExistingMember] = useState<MemberData | null>(null)
  const [formData, setFormData] = useState<ApplicationFormData>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("amasi_apply_form")
        if (saved) return { ...INITIAL_FORM_DATA, ...JSON.parse(saved) }
      } catch {}
    }
    return INITIAL_FORM_DATA
  })
  const [uploads, setUploads] = useState<Record<string, UploadEntry>>({})
  const [expandedTips, setExpandedTips] = useState<Record<string, boolean>>({})
  const [processing, setProcessing] = useState(false)
  const [selectedType, setSelectedType] = useState<MembershipType | null>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("amasi_apply_type")
      if (saved) return MEMBERSHIP_TYPES.find(t => t.id === saved) || null
    }
    return null
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editSection, setEditSection] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Auto-save form data to localStorage
  useEffect(() => {
    localStorage.setItem("amasi_apply_form", JSON.stringify(formData))
  }, [formData])
  useEffect(() => {
    if (phase !== "check" && phase !== "verify") localStorage.setItem("amasi_apply_phase", phase)
  }, [phase])
  useEffect(() => {
    if (selectedType) localStorage.setItem("amasi_apply_type", selectedType.id)
  }, [selectedType])
  const [emailVerified, setEmailVerified] = useState(false)
  const [verifyStep, setVerifyStep] = useState<"input" | "email_otp" | "done">("input")
  const [otpCode, setOtpCode] = useState("")
  const [otpCooldown, setOtpCooldown] = useState(0)
  const [verifying, setVerifying] = useState(false)

  // Resume draft dialog state
  const [showResumeDraft, setShowResumeDraft] = useState(false)
  const [draftChecked, setDraftChecked] = useState(false)
  const [serverDraft, setServerDraft] = useState<any>(null)
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string | null>(null)
  const [resumingDraft, setResumingDraft] = useState(false)

  // Check for saved draft on mount (localStorage only — server draft check happens after OTP)
  useEffect(() => {
    if (!draftChecked && typeof window !== "undefined") {
      const savedPhase = localStorage.getItem("amasi_apply_phase")
      const savedForm = localStorage.getItem("amasi_apply_form")
      if (savedPhase && savedForm) {
        try {
          const parsed = JSON.parse(savedForm)
          // Only show resume if there's meaningful data
          if (parsed.firstName || parsed.email || parsed.eduPostgradDegree) {
            setShowResumeDraft(true)
          }
        } catch {}
      }
      setDraftChecked(true)
    }
  }, [draftChecked])

  // Save draft to server after each step change (only after email is verified)
  const saveDraftToServer = useCallback(async (step: number, extraData?: Record<string, any>) => {
    if (!emailVerified || !formData.email) return
    try {
      // Sanitize extracted OCR data — strip non-JSON-safe values
      const safeUploads = Object.fromEntries(
        Object.entries(uploads).map(([k, v]) => {
          const safeExtracted: Record<string, any> = {}
          for (const [ek, ev] of Object.entries(v.extracted || {})) {
            if (typeof ev === "string" || typeof ev === "number" || typeof ev === "boolean" || ev === null) {
              safeExtracted[ek] = ev
            }
          }
          return [k, { status: v.status, extracted: safeExtracted, message: v.message }]
        })
      )
      const body: any = {
        email: formData.email,
        current_step: step,
        step_data: {
          formData,
          membership_type: selectedType?.id || formData.membershipType,
          uploads: safeUploads,
          ...extraData,
        },
      }
      if (draftUpdatedAt) body.lastUpdatedAt = draftUpdatedAt
      const res = await fetch("/api/applications/save-draft", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        const data = await res.json()
        if (data.draft?.updated_at) setDraftUpdatedAt(data.draft.updated_at)
      } else if (res.status === 409) {
        toast.error("This application is being continued on another device. Please close this tab.")
      }
    } catch {
      // Draft save failure is non-blocking
    }
  }, [emailVerified, formData, selectedType, uploads, draftUpdatedAt])

  // Auto-save draft every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (phase !== "check" && phase !== "success") {
        localStorage.setItem("amasi_apply_form", JSON.stringify(formData))
        localStorage.setItem("amasi_apply_phase", phase)
        if (selectedType) localStorage.setItem("amasi_apply_type", selectedType.id)
      }
    }, 30000)
    return () => clearInterval(interval)
  }, [formData, phase, selectedType])

  // Pre-warm Face Detection on mount
  useEffect(() => {
    preloadFaceDetection()
  }, [])

  const handleFileUpload = useCallback(async (docType: string, file: File) => {
    const preview = URL.createObjectURL(file)
    setUploads((prev) => ({
      ...prev,
      [docType]: { file, preview, status: "processing", extracted: {} },
    }))

    try {
      const uploadData = new FormData()
      uploadData.append("file", file)
      uploadData.append("docType", docType)

      const res = await fetch("/api/ocr", { method: "POST", body: uploadData })
      const result = await res.json()

      // Reject irrelevant documents — show as red rejected card
      if (result.isIrrelevant || !result.success) {
        const rejectMessage = result.message || result.error || "This doesn't appear to be a valid medical document. Please upload the correct certificate."
        setUploads((prev) => ({
          ...prev,
          [docType]: { file, preview, status: "rejected", extracted: {}, message: rejectMessage },
        }))
        toast.error(rejectMessage)
        return
      }

      const extracted = result.extracted || {}

      // Check eligibility for PG degree
      if (result.eligibility && !result.eligibility.eligible) {
        if (result.eligibility.softBlock) {
          // AI uncertain — show green "Document received", route silently to admin
          setUploads((prev) => ({
            ...prev,
            [docType]: { file, preview, status: "extracted", extracted, eligibility: result.eligibility },
          }))
          toast.success("Document received — under review")
        } else {
          setUploads((prev) => ({
            ...prev,
            [docType]: { file, preview, status: "blocked", extracted, eligibility: result.eligibility, message: result.eligibility.reason },
          }))
          toast.error(result.eligibility.reason)
        }
        return
      }

      // Show expiry warnings
      if (result.expiryWarnings && result.expiryWarnings.length > 0) {
        result.expiryWarnings.forEach((w: string) => toast.warning(w, { duration: 8000 }))
      }

      // Auto-fill form fields from ALL extracted data
      const updates: Partial<ApplicationFormData> = {}

      // --- Name extraction with validation ---
      const rawName = extracted.full_name || extracted.name || extracted.applicant_name
      if (rawName) {
        const cleanName = rawName
          .replace(/^(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?|Shri\.?)\s*/gi, "")
          .replace(/\s+/g, " ").trim()
        const junkWords = ["the", "of", "and", "for", "this", "that", "with", "from", "qualification", "certificate", "registration", "additional", "medical", "council", "not visible", "null", "n/a", "has", "been", "duly", "admitted", "hereby", "certify", "certified", "granted", "issued", "registered", "pursuant", "herewith", "whereas", "therefore", "hel", "she", "he", "is", "was", "are"]
        const junkPhrases = ["duly admitted", "has been", "hereby certif", "is registered", "not visible", "granted to", "issued to"]
        const nameParts = cleanName.split(/\s+/)
        const containsJunkPhrase = junkPhrases.some(p => cleanName.toLowerCase().includes(p))
        const isValidName = !containsJunkPhrase && nameParts.length >= 1 && nameParts.length <= 6 &&
          cleanName.length >= 3 && cleanName.length <= 60 &&
          !junkWords.includes(nameParts[0].toLowerCase()) && /^[A-Za-z]/.test(nameParts[0])
        if (isValidName) {
          if (nameParts[0]) updates.firstName = nameParts[0]
          if (nameParts.length === 2) updates.lastName = nameParts[1]
          if (nameParts.length >= 3) { updates.middleName = nameParts[1]; updates.lastName = nameParts.slice(2).join(" ") }
        }
      }

      // --- MCI Certificate fields ---
      if (extracted.registration_number) updates.mciCouncilNumber = extracted.registration_number
      const councilState = extracted.state || extracted.council_state
      if (councilState) {
        const matchedState = INDIAN_STATES.find(s => councilState.toLowerCase().includes(s.toLowerCase()))
        if (matchedState) {
          updates.mciCouncilState = matchedState
          if (!formData.state) { updates.state = matchedState; updates.zone = STATE_TO_ZONE[matchedState] || "" }
        }
      }
      // DOB: handle multiple formats
      if (extracted.date_of_birth && extracted.date_of_birth !== "null") {
        let dob = extracted.date_of_birth
        // Convert DD-MM-YYYY or DD/MM/YYYY to YYYY-MM-DD
        const ddmmyyyy = dob.match(/^(\d{2})[-\/](\d{2})[-\/](\d{4})$/)
        if (ddmmyyyy) dob = `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`
        if (/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          const [y, m, d] = dob.split("-").map(Number)
          const date = new Date(y, m - 1, d)
          if (date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d && y >= 1930 && y <= 2015) {
            updates.dob = dob
          }
        }
      }
      if (extracted.gender && extracted.gender !== "null") updates.gender = extracted.gender
      if (extracted.father_name && extracted.father_name !== "null") {
        updates.fatherName = extracted.father_name.replace(/^(Mr\.?|Shri\.?|Late\.?|S\/o|D\/o|W\/o)\s*/i, "").trim()
      }
      // Address from MCI certificate
      if (extracted.address && extracted.address !== "null" && !formData.streetLine1) {
        updates.streetLine1 = extracted.address.length > 100 ? extracted.address.slice(0, 100) : extracted.address
      }
      if (extracted.city && extracted.city !== "null" && !formData.city) updates.city = extracted.city
      if (extracted.pin_code && extracted.pin_code !== "null" && !formData.pin) updates.pin = extracted.pin_code
      // Qualifications from MCI cert
      const quals = extracted.qualification_noted || extracted.qualifications
      if (quals && quals !== "null") {
        const qualsLower = quals.toLowerCase()
        if (!formData.eduPostgradDegree) {
          const pgMatch = qualsLower.match(/(m\.?s\.?\s*\([^)]+\)|m\.?ch\.?\s*\([^)]+\)|m\.?d\.?\s*\([^)]+\)|d\.?n\.?b\.?\s*\([^)]+\))/i)
          if (pgMatch) updates.eduPostgradDegree = pgMatch[1].trim()
        }
      }

      // --- Degree Certificate fields ---
      const degree = extracted.degree_name || extracted.degree
      if (degree) {
        const fullDegree = extracted.specialisation ? `${degree} (${extracted.specialisation})` : degree
        if (docType === "pg_degree_certificate") updates.eduPostgradDegree = fullDegree
        else updates.eduUndergradDegree = fullDegree
      }
      const university = extracted.university_name || extracted.university
      if (university) {
        if (docType === "pg_degree_certificate") updates.eduPostgradUniversity = university
        else updates.eduUndergradUniversity = university
      }
      const college = extracted.institution_name || extracted.college
      if (college) {
        if (docType === "pg_degree_certificate") updates.eduPostgradCollege = college
        else updates.eduUndergradCollege = college
      }
      if (extracted.year_of_passing) {
        const year = String(extracted.year_of_passing)
        if (/^\d{4}$/.test(year)) {
          if (docType === "pg_degree_certificate") updates.eduPostgradYear = year
          else updates.eduUndergradYear = year
        }
      }

      // --- ASI Certificate fields ---
      const asiId = extracted.asi_membership_id || extracted.asi_membership_number
      if (asiId) updates.asiMembershipNo = asiId
      const asiBranch = extracted.branch || extracted.asi_state
      if (asiBranch) {
        const matchedState = INDIAN_STATES.find(s => asiBranch.toLowerCase().includes(s.toLowerCase()))
        if (matchedState) updates.asiState = matchedState
      }

      // --- HOD Letter fields ---
      if (docType === "letter_hod" && extracted.institution_name) {
        if (!formData.eduPostgradCollege) updates.eduPostgradCollege = extracted.institution_name
      }

      // --- Active License fields ---
      // NOTE: an international active license number is NOT an MCI/NMC council
      // number — overwriting mciCouncilNumber here would break NMC verification
      // for international members. Store separately in form state only.
      if (extracted.license_number) updates.intlLicenseNumber = extracted.license_number
      if (extracted.country && extracted.country !== "null") updates.nationality = extracted.country

      // --- Smart defaults ---
      if (!formData.nationality && !updates.nationality) updates.nationality = "Indian"
      if (!formData.mobileCode && !updates.mobileCode) updates.mobileCode = "+91"
      if (!formData.salutation && !updates.salutation) updates.salutation = "Dr."

      if (Object.keys(updates).length > 0) {
        setFormData((prev) => ({ ...prev, ...updates }))
      }

      // Name cross-check between documents
      let nameWarning = ""
      const extractedName = extracted.full_name || extracted.name || extracted.applicant_name
      if (extractedName) {
        const otherDocs = Object.entries(uploads).filter(([key]) => key !== docType && key !== "profile")
        for (const [, otherUpload] of otherDocs) {
          const otherName = otherUpload.extracted?.full_name || otherUpload.extracted?.name || otherUpload.extracted?.applicant_name
          if (otherName) {
            const name1 = extractedName.toLowerCase().replace(/^(dr\.?|prof\.?)\s*/i, "").trim()
            const name2 = otherName.toLowerCase().replace(/^(dr\.?|prof\.?)\s*/i, "").trim()
            const firstName1 = name1.split(/\s+/)[0]
            const firstName2 = name2.split(/\s+/)[0]
            if (firstName1 !== firstName2) {
              nameWarning = `Name mismatch: "${extractedName}" on this document vs "${otherName}" on another document. Please ensure all documents belong to the same person.`
              toast.warning(nameWarning)
            }
          }
        }
      }

      const fieldCount = Object.keys(updates).length
      setUploads((prev) => ({
        ...prev,
        [docType]: {
          file, preview,
          status: "extracted",
          extracted,
          eligibility: result.eligibility,
          message: nameWarning || (fieldCount > 0 ? `Extracted ${fieldCount} fields` : "Document verified"),
        },
      }))

      // Save draft after each successful document upload
      saveDraftToServer(3)

      // Show what was extracted in a detailed toast
      const extractedLabels: string[] = []
      if (updates.firstName) extractedLabels.push("Name")
      if (updates.dob) extractedLabels.push("DOB")
      if (updates.gender) extractedLabels.push("Gender")
      if (updates.fatherName) extractedLabels.push("Father")
      if (updates.mciCouncilNumber) extractedLabels.push("MCI Number")
      if (updates.mciCouncilState) extractedLabels.push("Council State")
      if (updates.eduPostgradDegree) extractedLabels.push("PG Degree")
      if (updates.eduPostgradCollege) extractedLabels.push("PG College")
      if (updates.eduPostgradUniversity) extractedLabels.push("University")
      if (updates.eduPostgradYear) extractedLabels.push("Year")
      if (updates.city) extractedLabels.push("City")
      if (updates.state) extractedLabels.push("State")
      if (updates.asiMembershipNo) extractedLabels.push("ASI Number")
      if (extractedLabels.length > 0) {
        toast.success(`AI extracted: ${extractedLabels.join(", ")}`)
      } else {
        toast.success(`${DOC_LABELS[docType as DocType]} verified`)
      }
    } catch (err: any) {
      setUploads((prev) => ({
        ...prev,
        [docType]: { file, preview, status: "uploaded", extracted: {}, message: "Could not read this document. Please try a clearer photo." },
      }))
      toast.error("Could not read this document. Please try uploading a clearer photo.")
    }
  }, [formData, uploads])

  const handleRemoveFile = (docType: string) => {
    setUploads((prev) => {
      const copy = { ...prev }
      if (copy[docType]?.preview) URL.revokeObjectURL(copy[docType].preview)
      delete copy[docType]
      return copy
    })
  }

  const handleProcessAll = async () => {
    setProcessing(true)
    // Auto-detect membership type based on extracted data
    if (!formData.membershipType) {
      if (formData.asiMembershipNo) {
        setFormData((prev) => ({ ...prev, membershipType: "LM" }))
        setSelectedType(getMembershipType("LM")!)
      } else if (formData.eduPostgradDegree) {
        setFormData((prev) => ({ ...prev, membershipType: "ALM" }))
        setSelectedType(getMembershipType("ALM")!)
      } else {
        setFormData((prev) => ({ ...prev, membershipType: "ALM" }))
        setSelectedType(getMembershipType("ALM")!)
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
    setProcessing(false)
    setPhase("review")
    // Save draft at step 4 (review)
    saveDraftToServer(4)
  }

  const [termsAccepted, setTermsAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refNumber, setRefNumber] = useState("")
  const [existingPayment, setExistingPayment] = useState<{ gateway_payment_id: string; reference_number: string } | null>(null)

  const [approvalResult, setApprovalResult] = useState<{ approved: boolean; amasiNumber?: number } | null>(null)

  const handleSubmit = async () => {
    const personalErrors = validatePersonalDetails(formData)
    const eduErrors = validateEducation(formData)
    const regErrors = validateRegistration(formData)
    const allSubmitErrors = { ...personalErrors, ...eduErrors, ...regErrors }

    if (Object.keys(allSubmitErrors).length > 0) {
      setErrors(allSubmitErrors)
      toast.error("Please fill in the required fields highlighted in red")
      return
    }

    if (!termsAccepted) {
      toast.error("Please accept the terms and conditions")
      return
    }

    setSubmitting(true)

    // If we have an existing payment (recovery flow), skip payment and go straight to submit
    if (existingPayment) {
      const ref = refNumber || generateRefNumber()
      if (!refNumber) setRefNumber(ref)

      const uploadData = Object.fromEntries(
        Object.entries(uploads).map(([k, v]) => [k, { status: v.status, extracted: v.extracted, message: v.message }])
      )

      try {
        const submitRes = await fetch("/api/applications/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            formData,
            referenceNumber: ref,
            paymentId: existingPayment.gateway_payment_id,
            uploads: uploadData,
          }),
        })
        const submitData = await submitRes.json()

        if (submitData.status) {
          setApprovalResult({
            approved: submitData.approved,
            amasiNumber: submitData.amasiNumber,
          })
          setPhase("success")
          toast.success(submitData.approved ? "Membership approved!" : "Application submitted for review!")
        } else {
          toast.error(submitData.message || "Failed to submit application")
        }
      } catch {
        toast.error("Something went wrong. Please try again.")
      }
      setSubmitting(false)
      return
    }

    // Check for duplicate. On network/parse failure, abort and let the user retry —
    // silently proceeding would bypass duplicate detection and allow a double payment.
    try {
      const dupRes = await fetch("/api/applications/check-duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: formData.email, mobile: formData.mobile, mciCouncilNumber: formData.mciCouncilNumber }),
      })
      const dupData = await dupRes.json()
      if (dupData.isDuplicate) {
        toast.error(dupData.message || "A duplicate application was found")
        setSubmitting(false)
        return
      }
    } catch {
      toast.error("Could not verify duplicate. Please try again.")
      setSubmitting(false)
      return
    }

    const ref = generateRefNumber()
    setRefNumber(ref)

    const type = selectedType || getMembershipType(formData.membershipType)
    const fee = type ? calculateFee(type) : null
    const totalAmount = fee ? fee.totalFee : 4230

    // Step 1: Create Razorpay order
    let orderId = ""
    try {
      const orderRes = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: totalAmount,
          currency: fee?.currency === "$" ? "USD" : "INR",
          referenceNumber: ref,
          email: formData.email,
          name: `${formData.firstName} ${formData.lastName}`.trim(),
          membershipType: formData.membershipType || type?.id || type?.name,
        }),
      })
      const orderData = await orderRes.json()
      if (!orderData.status || !orderData.orderId) {
        toast.error(orderData.message || "Failed to create payment order")
        setSubmitting(false)
        return
      }
      orderId = orderData.orderId
      // Save draft with payment order ID (step 5)
      saveDraftToServer(5, { payment_order_id: orderId })
    } catch {
      toast.error("Payment service unavailable. Please try again.")
      setSubmitting(false)
      return
    }

    // Step 2: Open Razorpay checkout
    const rzpKeyId = process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID
    if (!rzpKeyId || typeof window === "undefined") {
      toast.error("Payment not configured")
      setSubmitting(false)
      return
    }

    // Load Razorpay script if not loaded
    if (!(window as any).Razorpay) {
      try {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement("script")
          script.src = "https://checkout.razorpay.com/v1/checkout.js"
          script.onload = () => resolve()
          script.onerror = () => reject(new Error("Failed to load payment gateway"))
          document.body.appendChild(script)
        })
      } catch {
        toast.error("Unable to load payment gateway. Please check your internet connection and try again.")
        setSubmitting(false)
        return
      }
    }

    const rzp = new (window as any).Razorpay({
      key: rzpKeyId,
      amount: totalAmount * 100,
      currency: fee?.currency === "$" ? "USD" : "INR",
      name: "AMASI",
      description: `${type?.name || "Membership"} Application — ${ref}`,
      image: "/amasi-logo.png",
      order_id: orderId,
      prefill: {
        name: `${formData.salutation} ${formData.firstName} ${formData.lastName}`.trim(),
        email: formData.email,
        contact: `${formData.mobileCode || "+91"}${formData.mobile}`,
      },
      notes: {
        referenceNumber: ref,
        membershipType: type?.name || formData.membershipType,
        applicantName: `${formData.firstName} ${formData.lastName}`.trim(),
      },
      theme: { color: "#0f766e" },
      handler: async (response: any) => {
        // Step 3: Verify payment
        try {
          const verifyRes = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              referenceNumber: ref,
              amount: totalAmount,
              currency: fee?.currency === "$" ? "USD" : "INR",
              email: formData.email,
            }),
          })
          const verifyData = await verifyRes.json()

          if (!verifyData.status) {
            toast.error("Payment verification failed")
            setSubmitting(false)
            return
          }

          toast.success("Payment successful!")

          // Save draft immediately with payment info — safety net before submit
          saveDraftToServer(5, { payment_order_id: orderId, payment_id: response.razorpay_payment_id, payment_verified: true })

          // Step 4: Submit application with retry (up to 3 attempts)
          const uploadData = Object.fromEntries(
            Object.entries(uploads).map(([k, v]) => [k, { status: v.status, extracted: v.extracted, message: v.message }])
          )

          const submitPayload = {
            formData,
            referenceNumber: ref,
            paymentId: response.razorpay_payment_id,
            uploads: uploadData,
          }

          let submitSuccess = false
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const submitRes = await fetch("/api/applications/submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(submitPayload),
              })
              const submitData = await submitRes.json()

              if (submitData.status) {
                setApprovalResult({
                  approved: submitData.approved,
                  amasiNumber: submitData.amasiNumber,
                })
                setPhase("success")
                toast.success(submitData.approved ? "Membership approved!" : "Application submitted for review!")
                submitSuccess = true
                break
              } else {
                if (attempt < 3) {
                  await new Promise(r => setTimeout(r, 2000 * attempt))
                } else {
                  toast.error(submitData.message || "Failed to submit application")
                }
              }
            } catch {
              if (attempt < 3) {
                toast.info(`Retrying submission (attempt ${attempt + 1}/3)...`)
                await new Promise(r => setTimeout(r, 2000 * attempt))
              }
            }
          }

          if (!submitSuccess) {
            toast.error("Your payment is safe but submission failed. We have saved your application. Please try again or contact support.")
          }
        } catch {
          toast.error("Something went wrong. Your payment is safe — please try again or contact support.")
        }
        setSubmitting(false)
      },
      modal: {
        ondismiss: () => {
          toast.info("Payment cancelled")
          setPhase("review")
          setSubmitting(false)
        },
      },
    })

    setPhase("confirm")
    rzp.open()
  }

  // Keyboard shortcut: Ctrl+Enter to proceed to next step
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault()
        if (phase === "upload") {
          const type = selectedType || getMembershipType(formData.membershipType)
          const requiredDocs = type?.requiredDocs.filter((d: string) => d !== "profile") || []
          const allUploaded = requiredDocs.every((d: string) => uploads[d]?.file) && uploads.profile?.file
          const allVerified = requiredDocs.every((d: string) => uploads[d]?.status === "extracted" || uploads[d]?.status === "uploaded")
          const hasBlockedDoc = Object.values(uploads).some((u) => u.status === "blocked" || u.status === "rejected")
          const isProcessing = Object.values(uploads).some((u) => u.status === "processing")
          if (allUploaded && allVerified && !hasBlockedDoc && !isProcessing) {
            handleProcessAll()
          }
        } else if (phase === "review") {
          if (submitting) return
          if (termsAccepted) handleSubmit()
        }
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [phase, uploads, selectedType, formData, termsAccepted, submitting])

  const updateField = (field: string, value: string) => {
    let processed = value

    // Auto-capitalize name fields
    if (["firstName", "middleName", "lastName", "fatherName"].includes(field)) {
      processed = autoCapitalize(value)
    }

    setFormData((prev) => {
      const updated = { ...prev, [field]: processed }

      // State → auto-fill zone
      if (field === "state") {
        updated.zone = STATE_TO_ZONE[value] || ""
        // Auto-fill MCI council state if empty
        if (!prev.mciCouncilState) updated.mciCouncilState = value
      }

      // MCI council state → auto-fill address state if empty
      if (field === "mciCouncilState" && !prev.state) {
        updated.state = value
        updated.zone = STATE_TO_ZONE[value] || ""
      }

      return updated
    })

    setErrors((prev) => {
      const copy = { ...prev }
      delete copy[field]
      return copy
    })
  }

  // Clear saved data on successful submission
  const clearSavedForm = () => {
    localStorage.removeItem("amasi_apply_form")
    localStorage.removeItem("amasi_apply_phase")
    localStorage.removeItem("amasi_apply_type")
  }

  // Move clearSavedForm into useEffect
  useEffect(() => { if (phase === "success") clearSavedForm() }, [phase])

  const handleCheckMembership = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!checkQuery.trim()) return
    setChecking(true)
    try {
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(checkQuery.trim())}`)
      const data = await res.json()
      if (data.status && data.data?.length > 0) {
        setExistingMember(data.data[0])
        setPhase("existing")
      } else {
        // Not found — prefill email/phone and proceed to verify
        const isEmail = checkQuery.includes("@")
        const isPhone = /^\d{10}$/.test(checkQuery.trim())
        setFormData((prev) => ({
          ...prev,
          email: isEmail ? checkQuery.trim() : prev.email,
          mobile: isPhone ? checkQuery.trim() : prev.mobile,
        }))
        setPhase("verify")
      }
    } catch {
      toast.error("Could not check membership. Please try again.")
    }
    setChecking(false)
  }

  // Dismiss saved draft and clear storage
  const dismissDraft = () => {
    setShowResumeDraft(false)
    localStorage.removeItem("amasi_apply_form")
    localStorage.removeItem("amasi_apply_phase")
    localStorage.removeItem("amasi_apply_type")
    setFormData(INITIAL_FORM_DATA)
    setSelectedType(null)
    setPhase("check")
  }

  // ===== CHECK PHASE =====
  if (phase === "check") {
    return (
      <div className="max-w-lg mx-auto px-4 py-12 sm:py-16">
        {/* Resume draft dialog */}
        <AnimatePresence>
          {showResumeDraft && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-6"
            >
              <Card className="border-primary/30 bg-primary/5 shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                      <ClipboardCheck className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">Resume your application?</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        You have a saved draft{formData.firstName ? ` for ${formData.firstName}` : ""}. Would you like to continue where you left off?
                      </p>
                      <div className="flex gap-2 mt-3">
                        <Button size="sm" className="h-8 text-xs font-semibold gap-1.5" onClick={() => setShowResumeDraft(false)}>
                          <ArrowRight className="h-3 w-3" /> Resume Draft
                        </Button>
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={dismissDraft}>
                          Start Fresh
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-5">
            <Stethoscope className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">AMASI Membership</h1>
          <p className="text-muted-foreground text-base">
            Association of Minimal Access Surgeons of India
          </p>
          <div className="inline-flex items-center gap-1.5 mt-3 text-xs text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full">
            <Clock className="h-3.5 w-3.5" />
            <span>Estimated time: ~2 minutes</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card className="shadow-sm">
            <CardContent className="p-6">
              <h2 className="font-semibold text-lg mb-1">Let&apos;s check your membership</h2>
              <p className="text-sm text-muted-foreground mb-5">
                Search by email, phone number, name, or AMASI membership number to check your membership status.
              </p>
              <form onSubmit={handleCheckMembership} className="space-y-4">
                <Input
                  placeholder="Email, mobile number, name, or membership number"
                  value={checkQuery}
                  onChange={(e) => setCheckQuery(e.target.value)}
                  className="h-12 text-base"
                />
                <Button type="submit" className="w-full h-12 text-base font-semibold gap-2 min-h-[44px]" disabled={checking || !checkQuery.trim()}>
                  {checking ? (
                    <><Loader2 className="h-5 w-5 animate-spin" /> Checking...</>
                  ) : (
                    <><ArrowRight className="h-5 w-5" /> Check &amp; Continue</>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="flex items-center justify-center gap-6 sm:gap-8 mt-10 text-center"
        >
          {[
            { icon: Shield, label: "18,000+ Members" },
            { icon: Award, label: "35+ Years" },
            { icon: Clock, label: "2 Min to Apply" },
          ].map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
              <item.icon className="h-4 w-4 text-primary shrink-0" />
              <span>{item.label}</span>
            </div>
          ))}
        </motion.div>
      </div>
    )
  }

  // ===== EXISTING MEMBER PHASE =====
  if (phase === "existing" && existingMember) {
    const m = existingMember as any
    const isIncomplete = m.profile_incomplete
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg mx-auto py-12"
      >
        <Card>
          <CardContent className="pt-6 text-center">
            <div className={`h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4 ${isIncomplete ? "bg-warning/10" : "bg-success/10"}`}>
              {isIncomplete ? (
                <AlertCircle className="h-8 w-8 text-warning" />
              ) : (
                <CheckCircle className="h-8 w-8 text-success" />
              )}
            </div>
            <h2 className="text-xl font-bold mb-1">
              {isIncomplete ? "Profile Incomplete" : "You're already a member!"}
            </h2>
            <p className="text-muted-foreground text-sm mb-4">
              {isIncomplete
                ? "We found your membership, but your profile is missing important details. Please update your documents and information."
                : "We found your AMASI membership. Here are your details:"}
            </p>

            {isIncomplete && (
              <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 mb-4 text-left">
                <p className="text-sm font-medium text-warning mb-2">Missing Information:</p>
                <ul className="text-xs text-muted-foreground space-y-1">
                  {!m.mci_council_number && <li>- MCI / State Medical Council Number</li>}
                  {!m.pg_degree && <li>- PG Degree details</li>}
                  {!m.date_of_birth && <li>- Date of Birth</li>}
                  {!m.gender && <li>- Gender</li>}
                  <li>- Document uploads (MCI Certificate, PG Degree)</li>
                </ul>
              </div>
            )}

            <div className="text-left bg-muted/50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Name</span>
                <span className="font-medium">{m.salutation} {m.first_name} {m.middle_name} {m.last_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Membership No</span>
                <span className="font-bold text-primary">{m.membership_no}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Type</span>
                <span>{m.application_name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={m.status_name === "Membership Number Allotted" ? "success" : "warning"}>
                  {m.status_name}
                </Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Email</span>
                <span>{m.email}</span>
              </div>
              {m.mobile && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Mobile</span>
                  <span>{m.mobile_code} {m.mobile}</span>
                </div>
              )}
              {m.pg_degree && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">PG Degree</span>
                  <span>{m.pg_degree}</span>
                </div>
              )}
              {m.mci_council_number && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">MCI Number</span>
                  <span>{m.mci_council_number}</span>
                </div>
              )}
            </div>

            <div className="mt-6 space-y-2">
              {isIncomplete && (
                <Button className="w-full gap-2" onClick={() => {
                  // Pre-fill form with existing data and go to upload
                  setFormData(prev => ({
                    ...prev,
                    email: m.email || "",
                    firstName: m.first_name || "",
                    lastName: m.last_name || "",
                    mobile: m.mobile || "",
                    membershipType: m.application_name?.includes("Life Member [LM]") ? "LM" : m.application_name?.includes("ALM") ? "ALM" : m.application_name?.includes("ACM") ? "ACM" : "ALM",
                  }))
                  setSelectedType(getMembershipType(
                    m.application_name?.includes("Life Member [LM]") && !m.application_name?.includes("ALM") ? "LM" : m.application_name?.includes("ALM") ? "ALM" : m.application_name?.includes("ACM") ? "ACM" : "ALM"
                  ) || null)
                  setPhase("upload")
                  toast.info("Please upload your documents to complete your profile")
                }}>
                  <Upload className="h-4 w-4" /> Update Profile & Upload Documents
                </Button>
              )}
              {!isIncomplete && (m.application_name?.includes("ALM") || m.application_name?.includes("Associate Life")) && (
                <a href="/member" className="block">
                  <Button className="w-full gap-2">
                    <ArrowRight className="h-4 w-4" /> Upgrade to Life Member (LM)
                  </Button>
                </a>
              )}
              <Button variant="outline" className="w-full" onClick={() => { setExistingMember(null); setCheckQuery(""); setPhase("check") }}>
                Check Another
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => window.location.href = "https://www.amasi.org"}>
                Visit AMASI Website
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    )
  }

  // ===== LANDING PHASE =====
  if (phase === "landing") {
    return (
      <div className="max-w-5xl mx-auto px-4">
        <ProgressBar currentPhase={phase} />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-10 sm:py-14"
        >
          <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-1.5 rounded-full text-sm font-medium mb-6">
            <Sparkles className="h-4 w-4" /> AI-Powered Application
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
            Join <span className="text-primary">AMASI</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-2">
            Association of Minimal Access Surgeons of India
          </p>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Upload your documents. Our AI reads them and fills your application automatically.
            <strong className="text-foreground"> Apply in 2 minutes.</strong>
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="mt-2"
        >
          <h2 className="text-lg font-semibold text-center mb-4">Choose Your Membership</h2>
          <div className="grid gap-4 sm:grid-cols-2 mb-14">
            {MEMBERSHIP_TYPES.map((type) => {
              const fee = calculateFee(type)
              return (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type)
                    setFormData((prev) => ({ ...prev, membershipType: type.id }))
                    setPhase(emailVerified ? "upload" : "verify")
                  }}
                  className="group rounded-xl border-2 p-5 text-left transition-all hover:border-primary hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary active:scale-[0.98]"
                >
                  <div className="flex items-center justify-between mb-3">
                    <Badge variant="secondary" className="text-xs font-semibold px-2.5 py-1">{type.shortName}</Badge>
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <h3 className="font-semibold mb-2 text-base">{type.name}</h3>
                  <p className="text-sm text-muted-foreground mb-2">{type.eligibility}</p>
                  <p className="text-xs text-muted-foreground mb-4">{type.description}</p>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold text-primary">
                        {fee.currency}{fee.totalFee.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">incl. GST</p>
                    </div>
                    {type.votingRights && (
                      <div className="flex items-center gap-1 text-xs font-medium text-primary bg-primary/5 px-2.5 py-1.5 rounded-full">
                        <Star className="h-3 w-3" /> Voting Rights
                      </div>
                    )}
                  </div>
                  <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                    <span className="font-medium">Required:</span> {type.requiredDocs.filter(d => d !== "profile").map(d => d.replace(/_/g, " ").replace("certificate", "cert")).join(", ")}
                  </div>
                </button>
              )
            })}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center py-8 border-t"
        >
          {[
            { icon: Users, value: "18,000+", label: "Members" },
            { icon: Shield, value: "35+", label: "Years" },
            { icon: Award, value: "Pan India", label: "Network" },
            { icon: Clock, value: "2 min", label: "To Apply" },
          ].map((stat, i) => (
            <div key={i} className="py-2">
              <stat.icon className="h-5 w-5 mx-auto text-primary mb-2" />
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    )
  }

  // ===== VERIFY PHASE (Email OTP only) =====
  if (phase === "verify") {
    const startCooldown = () => {
      setOtpCooldown(60)
      const timer = setInterval(() => {
        setOtpCooldown((c) => { if (c <= 1) { clearInterval(timer); return 0 } return c - 1 })
      }, 1000)
    }

    const sendEmailOtp = async () => {
      if (!formData.email || !formData.email.includes("@")) { toast.error("Please enter a valid email"); return }
      if (!formData.mobile || formData.mobile.length !== 10) { toast.error("Please enter a valid 10-digit mobile number"); return }
      try {
        const res = await fetch("/api/otp/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: formData.email, phone: formData.mobile, membershipType: selectedType?.id || formData.membershipType }) })
        const data = await res.json()
        if (data.status) { setVerifyStep("email_otp"); setOtpCode(""); startCooldown(); toast.success("OTP sent to your email") }
        else toast.error(data.message || "Failed to send OTP")
      } catch { toast.error("Failed to send OTP") }
    }

    const handleOtpVerify = async (code: string) => {
      if (code.length !== 6) return
      setVerifying(true)
      try {
        if (verifyStep === "email_otp") {
          const res = await fetch("/api/otp/verify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: formData.email, code }) })
          const data = await res.json()
          if (data.status) {
            setEmailVerified(true)
            toast.success("Email verified!")

            // Check if server has a draft with meaningful progress (beyond just OTP send)
            const hasMeaningfulDraft = data.hasDraft && data.draft && (data.draft.current_step > 2 || data.draft.has_verified_payment)
            if (hasMeaningfulDraft) {
              setServerDraft(data.draft)
              setDraftUpdatedAt(data.draft.updated_at)
              setVerifyStep("done")
              // Show resume prompt instead of proceeding
              setResumingDraft(true)
            } else {
              // Check for orphaned payment (paid but no application submitted)
              try {
                const payRes = await fetch(`/api/payments/check-existing?email=${encodeURIComponent(formData.email)}`)
                const payData = await payRes.json()
                if (payData.found && payData.payment) {
                  setExistingPayment(payData.payment)
                  setRefNumber(payData.payment.reference_number || "")
                  toast.info("Your previous payment was found. You won't be charged again.")
                }
              } catch {
                // Non-blocking — proceed normally if check fails
              }
              setVerifyStep("done")
              // Save initial draft to server
              saveDraftToServer(2, { email_verified: true })
              setTimeout(() => setPhase(selectedType ? "upload" : "landing"), 500)
            }
          } else {
            toast.error(data.message || "Invalid OTP")
            setOtpCode("")
          }
        }
      } catch { toast.error("Verification failed") }
      setVerifying(false)
    }

    const maskedEmail = formData.email.replace(/^(.{3})(.*)(@.*)$/, "$1***$3")

    return (
      <div className="max-w-md mx-auto px-4 py-4 sm:py-6">
        <ProgressBar currentPhase={phase} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <button onClick={() => { setPhase(selectedType ? "landing" : "check"); setVerifyStep("input"); setOtpCode(""); setEmailVerified(false) }} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 min-h-[44px]">
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {!selectedType && (
            <div className="text-center mb-6 p-4 bg-primary/5 border border-primary/20 rounded-xl">
              <p className="text-foreground font-semibold">No existing membership found</p>
              <p className="text-muted-foreground text-sm mt-1">Let&apos;s create your application! First, verify your contact details.</p>
            </div>
          )}

          {selectedType && <Badge className="mb-4">{selectedType.name}</Badge>}
          <h2 className="text-2xl font-bold mb-1">Verify Your Identity</h2>

          <Card className="shadow-sm">
            <CardContent className="p-6 space-y-4">
              {/* Step: Input email + mobile */}
              {verifyStep === "input" && (
                <>
                  <div>
                    <Label className="text-sm font-medium">Email <span className="text-destructive">*</span></Label>
                    <Input type="email" value={formData.email} onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))} placeholder="doctor@example.com" className="h-11 mt-1" />
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Mobile Number <span className="text-destructive">*</span></Label>
                    <div className="flex gap-2 mt-1">
                      <Input className="w-20 h-11" value={formData.mobileCode} onChange={(e) => setFormData((p) => ({ ...p, mobileCode: e.target.value }))} />
                      <Input className="flex-1 h-11" value={formData.mobile} onChange={(e) => setFormData((p) => ({ ...p, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }))} placeholder="10-digit mobile" />
                    </div>
                  </div>
                  <Button onClick={sendEmailOtp} className="w-full h-11 font-semibold" disabled={!formData.email || formData.mobile.length !== 10}>
                    Verify Email
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">We&apos;ll send a 6-digit code to your email</p>
                </>
              )}

              {/* Step: Email OTP */}
              {verifyStep === "email_otp" && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center"><span className="text-primary font-bold text-xs">&#9993;</span></div>
                    <span>Enter the code sent to <strong>{maskedEmail}</strong></span>
                  </div>
                  <Input
                    value={otpCode}
                    onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setOtpCode(v); if (v.length === 6) handleOtpVerify(v) }}
                    placeholder="000000"
                    className="text-center text-2xl font-bold tracking-[0.5em] h-14"
                    maxLength={6}
                    autoFocus
                  />
                  <div className="flex items-center justify-between">
                    <Button variant="ghost" size="sm" onClick={sendEmailOtp} disabled={otpCooldown > 0}>
                      {otpCooldown > 0 ? `Resend in ${otpCooldown}s` : "Resend"}
                    </Button>
                    <Button onClick={() => handleOtpVerify(otpCode)} disabled={otpCode.length !== 6 || verifying} size="sm">
                      {verifying ? "Verifying..." : "Verify Email"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Done — with optional resume prompt */}
              {verifyStep === "done" && !resumingDraft && (
                <div className="space-y-3 text-center py-6">
                  <div className="h-14 w-14 rounded-full bg-green-100 flex items-center justify-center mx-auto">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <p className="font-bold text-green-700 text-lg">Verified!</p>
                  <p className="text-sm text-muted-foreground">Proceeding to your application...</p>
                </div>
              )}

              {/* Resume draft prompt */}
              {verifyStep === "done" && resumingDraft && serverDraft && (
                <div className="space-y-4 py-4">
                  <div className="h-14 w-14 rounded-full bg-blue-100 flex items-center justify-center mx-auto">
                    <Clock className="h-8 w-8 text-blue-600" />
                  </div>
                  <div className="text-center">
                    <p className="font-bold text-lg">Welcome back!</p>
                    <p className="text-sm text-muted-foreground mt-1">You have an incomplete application from {new Date(serverDraft.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}.</p>
                  </div>
                  <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">You were on:</span>
                      <span className="font-medium">
                        {({ 1: "Select Type", 2: "Email Verification", 3: "Document Upload", 4: "Review Details", 5: "Payment", 6: "Submission" } as Record<number, string>)[serverDraft.current_step] || `Step ${serverDraft.current_step}`} (Step {serverDraft.current_step} of 6)
                      </span>
                    </div>
                    {serverDraft.membership_type && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Membership Type:</span>
                        <span className="font-medium">{serverDraft.membership_type}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <Button
                      className="flex-1 h-11 font-semibold"
                      onClick={async () => {
                        // Fetch full step_data from authenticated endpoint
                        try {
                          const draftRes = await fetch(`/api/applications/save-draft?email=${encodeURIComponent(formData.email)}`)
                          const draftData = await draftRes.json()
                          const stepData = draftData?.data?.step_data || {}
                          if (stepData.formData) {
                            setFormData((prev: ApplicationFormData) => ({ ...prev, ...stepData.formData }))
                          }
                          const mType = stepData.membership_type || serverDraft.membership_type
                          if (mType) {
                            const type = getMembershipType(mType)
                            if (type) setSelectedType(type)
                          }
                          // Restore uploads state (without File objects — shows previously processed docs)
                          if (stepData.uploads && typeof stepData.uploads === "object") {
                            const restoredUploads: Record<string, UploadEntry> = {}
                            for (const [k, v] of Object.entries(stepData.uploads as Record<string, any>)) {
                              if (v && typeof v === "object") {
                                restoredUploads[k] = {
                                  file: null as any,
                                  preview: "",
                                  status: v.status || "uploaded",
                                  extracted: v.extracted || {},
                                  message: v.message || "Restored from previous session",
                                }
                              }
                            }
                            setUploads(restoredUploads)
                          }
                          toast.success("Application restored. Continue where you left off.")
                        } catch {
                          toast.error("Could not restore application data. Please try again.")
                          return
                        }
                        setResumingDraft(false)
                        // Navigate to the step they were on
                        const stepToPhase: Record<number, Phase> = { 1: "landing", 2: "verify", 3: "upload", 4: "review", 5: "review", 6: "review" }
                        setPhase(stepToPhase[serverDraft.current_step] || "upload")
                      }}
                    >
                      Resume Application
                    </Button>
                    {!serverDraft.has_verified_payment ? (
                      <Button
                        variant="outline"
                        className="flex-1 h-11"
                        onClick={() => {
                          // Delete old draft and start fresh
                          fetch("/api/applications/save-draft?email=" + encodeURIComponent(formData.email), { method: "DELETE" }).catch(() => {})
                          setServerDraft(null)
                          setDraftUpdatedAt(null)
                          setResumingDraft(false)
                          setPhase(selectedType ? "upload" : "landing")
                        }}
                      >
                        Start Fresh
                      </Button>
                    ) : (
                      <p className="text-xs text-amber-600 self-center">This application has a pending payment. Please resume.</p>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    )
  }

  // ===== UPLOAD PHASE =====
  if (phase === "upload") {
    const type = selectedType || getMembershipType(formData.membershipType)
    const requiredDocs = type?.requiredDocs.filter((d) => d !== "profile") || []
    const allUploaded = requiredDocs.every((d) => uploads[d]?.file) && uploads.profile?.file
    const allVerified = requiredDocs.every((d) => uploads[d]?.status === "extracted" || uploads[d]?.status === "uploaded")
    const hasBlockedDoc = Object.values(uploads).some((u) => u.status === "blocked" || u.status === "rejected")
    const isProcessing = Object.values(uploads).some((u) => u.status === "processing")
    const hasPendingReview = Object.values(uploads).some((u) => u.status === "uploaded")
    const canContinue = allUploaded && allVerified && !hasBlockedDoc && !isProcessing

    return (
      <div>
      <ProgressBar currentPhase={phase} />
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        className="max-w-2xl mx-auto px-4 pt-4 space-y-6"
      >
        <button
          onClick={() => setPhase("landing")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px]"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="text-center">
          <Badge className="mb-3">{type?.name}</Badge>
          <h2 className="text-2xl font-bold tracking-tight">Upload Your Documents</h2>
          <p className="text-muted-foreground text-sm mt-1.5">
            Our AI will read your documents and fill the application for you
          </p>
        </div>

        <div className="space-y-4">
          {requiredDocs.map((docType) => {
            const upload = uploads[docType]
            const label = DOC_LABELS[docType as DocType]

            return (
              <motion.div
                key={docType}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                {!upload ? (
                  <div className="space-y-0">
                  <label className="flex items-center gap-4 rounded-xl border-2 border-dashed p-5 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all">
                    <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Upload className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{label}</p>
                      <p className="text-xs text-muted-foreground">JPG, PNG or PDF (max 5MB)</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">Required</Badge>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handleFileUpload(docType, file)
                      }}
                    />
                  </label>
                  {UPLOAD_TIPS[docType] && (
                    <div className="px-1">
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setExpandedTips(prev => ({ ...prev, [docType]: !prev[docType] })) }}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
                      >
                        <Info className="h-3.5 w-3.5" />
                        <span>Upload tips</span>
                        <ChevronDown className={`h-3 w-3 transition-transform ${expandedTips[docType] ? "rotate-180" : ""}`} />
                      </button>
                      {expandedTips[docType] && (
                        <div className="rounded-lg border bg-muted/30 p-3 mb-1 text-xs space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <p className="font-semibold text-green-700 mb-1">Do</p>
                              <ul className="space-y-0.5 text-muted-foreground">
                                {UPLOAD_TIPS[docType].dos.map((tip, i) => (
                                  <li key={i} className="flex gap-1.5 items-start">
                                    <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                                    <span>{tip}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div>
                              <p className="font-semibold text-red-700 mb-1">Don&apos;t</p>
                              <ul className="space-y-0.5 text-muted-foreground">
                                {UPLOAD_TIPS[docType].donts.map((tip, i) => (
                                  <li key={i} className="flex gap-1.5 items-start">
                                    <X className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                                    <span>{tip}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                          <div>
                            <p className="font-semibold text-primary mb-1">AI reads these fields</p>
                            <div className="flex flex-wrap gap-1">
                              {UPLOAD_TIPS[docType].aiReads.map((field, i) => (
                                <span key={i} className="bg-primary/10 text-primary px-2 py-0.5 rounded-full">{field}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  </div>
                ) : (
                  <div className={`rounded-xl border-2 p-4 ${
                    upload.status === "extracted" ? "border-green-400 bg-green-50" :
                    upload.status === "rejected" || upload.status === "blocked" ? "border-red-400 bg-red-50" :
                    upload.status === "uploaded" ? "border-amber-300 bg-amber-50" :
                    "border-primary/30 bg-primary/5"
                  }`}>
                    <div className="flex items-start gap-3">
                      <div className={`h-16 w-16 rounded-lg border flex items-center justify-center shrink-0 overflow-hidden ${
                        upload.status === "extracted" ? "border-green-300 bg-green-100" :
                        upload.status === "rejected" || upload.status === "blocked" ? "border-red-300 bg-red-100" :
                        "border-border bg-muted"
                      }`}>
                        {upload.status === "rejected" || upload.status === "blocked" ? (
                          <AlertCircle className="h-8 w-8 text-red-500" />
                        ) : upload.status === "extracted" ? (
                          <CheckCircle className="h-8 w-8 text-green-500" />
                        ) : upload.status === "uploaded" ? (
                          <Clock className="h-8 w-8 text-amber-500" />
                        ) : upload.file?.type?.startsWith("image/") ? (
                          <img src={upload.preview} alt={label} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex items-center justify-center h-full w-full"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-primary"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/></svg></div>' }} />
                        ) : (
                          <FileCheck className="h-6 w-6 text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{label}</p>
                          <button
                            onClick={() => handleRemoveFile(docType)}
                            aria-label={`Remove ${label}`}
                            className="p-1 hover:bg-accent rounded"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {upload.status === "processing" && (
                          <div className="flex items-center gap-2 mt-2 text-sm text-primary">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>AI is reading your document...</span>
                          </div>
                        )}
                        {upload.status === "extracted" && (
                          <div className="mt-2">
                            <div className="flex items-center gap-1.5 text-sm font-semibold text-green-700 mb-1.5">
                              <Sparkles className="h-4 w-4" />
                              <span>Extracted {Object.keys(upload.extracted || {}).filter(k => k !== "is_valid_medical_document" && upload.extracted[k]).length} fields</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(upload.extracted || {}).filter(([k, v]) => {
                                if (!v || k === "is_valid_medical_document" || k === "rejection_reason" || k === "detected_document_type" || k.startsWith("_")) return false
                                const s = String(v).toLowerCase()
                                if (s === "null" || s === "n/a" || s === "true" || s === "false") return false
                                // Filter junk from display
                                if (["duly admitted", "has been", "hereby certif", "not visible"].some(j => s.includes(j))) return false
                                return true
                              }).map(([key, val]) => (
                                <span key={key} className="text-xs bg-green-100 text-green-800 border border-green-200 px-2 py-0.5 rounded-full">
                                  {key}: {String(val).slice(0, 40)}
                                </span>
                              ))}
                            </div>
                            {upload.eligibility?.eligible && (
                              <div className="flex items-center gap-1.5 text-xs font-medium text-green-700 mt-2 bg-green-100 border border-green-200 rounded-md px-2 py-1 w-fit">
                                <CheckCircle className="h-3.5 w-3.5" />
                                <span>{upload.eligibility.reason}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {upload.status === "rejected" && (
                          <div className="mt-2">
                            <div className="flex items-center gap-2 font-bold text-red-700 text-base">
                              <AlertCircle className="h-5 w-5" /> Document Not Recognized
                            </div>
                            <p className="text-sm text-red-700 mt-1.5 leading-relaxed">{upload.message}</p>
                            <div className="flex gap-2 mt-3">
                              <Button variant="outline" size="sm" onClick={() => handleRemoveFile(docType)} className="text-xs">
                                <X className="h-3 w-3 mr-1" /> Remove & Re-upload
                              </Button>
                              <Button variant="ghost" size="sm" className="text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-50" onClick={() => {
                                setUploads((prev) => ({
                                  ...prev,
                                  [docType]: { ...prev[docType], status: "uploaded", message: "Pending manual review by admin team" },
                                }))
                                toast.info("Document will be reviewed manually by our admin team")
                              }}>
                                <Eye className="h-3 w-3 mr-1" /> Request Admin Review
                              </Button>
                            </div>
                          </div>
                        )}
                        {upload.status === "blocked" && (
                          <div className="mt-2">
                            <div className="flex items-center gap-2 font-bold text-red-700 text-base">
                              <AlertCircle className="h-5 w-5" /> Not Eligible
                            </div>
                            <p className="text-sm text-red-700 mt-1.5 leading-relaxed">{upload.message}</p>
                            <div className="flex gap-2 mt-3">
                              <Button variant="outline" size="sm" onClick={() => handleRemoveFile(docType)} className="text-xs">
                                <X className="h-3 w-3 mr-1" /> Remove & Re-upload
                              </Button>
                              <Button variant="ghost" size="sm" className="text-xs text-amber-700 hover:text-amber-800 hover:bg-amber-50" onClick={() => {
                                setUploads((prev) => ({
                                  ...prev,
                                  [docType]: { ...prev[docType], status: "uploaded", message: "Pending manual review — degree eligibility to be verified by admin" },
                                }))
                                toast.info("Your eligibility will be reviewed manually by our admin team")
                              }}>
                                <Eye className="h-3 w-3 mr-1" /> Request Admin Review
                              </Button>
                            </div>
                          </div>
                        )}
                        {upload.status === "uploaded" && (
                          <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-center gap-1.5 text-amber-700 text-sm font-medium">
                              <Clock className="h-4 w-4" /> Pending Admin Review
                            </div>
                            <p className="text-xs text-amber-600 mt-1">{upload.message || "This document will be manually verified by our admin team."}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </motion.div>
            )
          })}

          {/* Profile Photo */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {!uploads.profile ? (
              <div className="space-y-0">
              <label className="flex items-center gap-4 rounded-xl border-2 border-dashed p-5 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-all">
                <div className="h-12 w-12 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <Eye className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-sm">Profile Photo</p>
                  <p className="text-xs text-muted-foreground">Clear passport-size photo</p>
                </div>
                <Badge variant="outline" className="shrink-0">Required</Badge>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (!file) return

                    // Validate profile photo with MediaPipe face detection
                    const preview = URL.createObjectURL(file)
                    setUploads((prev) => ({ ...prev, profile: { file, preview, status: "processing", extracted: {} } }))

                    const img = new Image()
                    img.crossOrigin = "anonymous"
                    img.onload = async () => {
                      const result = await detectFace(img)

                      if (!result.hasFace) {
                        URL.revokeObjectURL(preview)
                        setUploads((prev) => { const c = { ...prev }; delete c.profile; return c })
                        toast.error(result.message)
                        return
                      }

                      if (result.faceCount > 1) {
                        URL.revokeObjectURL(preview)
                        setUploads((prev) => { const c = { ...prev }; delete c.profile; return c })
                        toast.error(result.message)
                        return
                      }

                      setUploads((prev) => ({ ...prev, profile: { file, preview, status: "uploaded", extracted: {} } }))
                      toast.success("Profile photo verified — face detected")
                    }
                    img.onerror = () => {
                      URL.revokeObjectURL(preview)
                      setUploads((prev) => { const c = { ...prev }; delete c.profile; return c })
                      toast.error("Could not read image. Please upload a valid photo file.")
                    }
                    img.src = preview
                  }}
                />
              </label>
              {UPLOAD_TIPS.profile && (
                <div className="px-1">
                  <button
                    type="button"
                    onClick={(e) => { e.preventDefault(); setExpandedTips(prev => ({ ...prev, profile: !prev.profile })) }}
                    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1.5"
                  >
                    <Info className="h-3.5 w-3.5" />
                    <span>Photo tips</span>
                    <ChevronDown className={`h-3 w-3 transition-transform ${expandedTips.profile ? "rotate-180" : ""}`} />
                  </button>
                  {expandedTips.profile && (
                    <div className="rounded-lg border bg-muted/30 p-3 mb-1 text-xs space-y-2.5 animate-in fade-in slide-in-from-top-1 duration-200">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <p className="font-semibold text-green-700 mb-1">Do</p>
                          <ul className="space-y-0.5 text-muted-foreground">
                            {UPLOAD_TIPS.profile.dos.map((tip, i) => (
                              <li key={i} className="flex gap-1.5 items-start">
                                <CheckCircle className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                                <span>{tip}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <p className="font-semibold text-red-700 mb-1">Don&apos;t</p>
                          <ul className="space-y-0.5 text-muted-foreground">
                            {UPLOAD_TIPS.profile.donts.map((tip, i) => (
                              <li key={i} className="flex gap-1.5 items-start">
                                <X className="h-3 w-3 text-red-400 mt-0.5 shrink-0" />
                                <span>{tip}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                      <div>
                        <p className="font-semibold text-primary mb-1">AI checks</p>
                        <div className="flex flex-wrap gap-1">
                          {UPLOAD_TIPS.profile.aiReads.map((field, i) => (
                            <span key={i} className="bg-primary/10 text-primary px-2 py-0.5 rounded-full">{field}</span>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              </div>
            ) : (
              <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
                <div className="flex items-center gap-3">
                  <img src={uploads.profile.preview} alt="Profile" className="h-16 w-16 rounded-full object-cover border-2" />
                  <div className="flex-1">
                    <p className="font-medium text-sm">Profile Photo</p>
                    <p className="text-xs text-success flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" /> Uploaded
                    </p>
                  </div>
                  <button
                    onClick={() => handleRemoveFile("profile")}
                    aria-label="Remove profile photo"
                    className="p-1 hover:bg-accent rounded"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>

        {/* Live form completion summary */}
        {Object.keys(uploads).filter(k => uploads[k]?.status === "extracted").length > 0 && (
          <Card className="border-green-200 bg-green-50/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2.5">
                <Sparkles className="h-4 w-4 text-green-600" />
                <p className="text-sm font-semibold text-green-700">AI has auto-filled</p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {formData.firstName && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full font-medium">{formData.salutation} {formData.firstName} {formData.lastName}</span>}
                {formData.dob && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full">DOB: {formData.dob}</span>}
                {formData.gender && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full">{formData.gender}</span>}
                {formData.mciCouncilNumber && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full">MCI: {formData.mciCouncilNumber}</span>}
                {formData.eduPostgradDegree && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full">{formData.eduPostgradDegree}</span>}
                {formData.eduPostgradCollege && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full">{formData.eduPostgradCollege}</span>}
                {formData.state && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full">{formData.state}</span>}
                {formData.asiMembershipNo && <span className="text-xs bg-green-100 text-green-800 px-2.5 py-1 rounded-full">ASI: {formData.asiMembershipNo}</span>}
              </div>
              {(!formData.dob || !formData.gender) && (
                <p className="text-xs text-amber-700 mt-3 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5">You&apos;ll need to fill: {[!formData.dob && "Date of Birth", !formData.gender && "Gender"].filter(Boolean).join(", ")} on the next page</p>
              )}
            </CardContent>
          </Card>
        )}

        {hasPendingReview && (
          <div className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="font-medium">Some documents will be manually reviewed by our admin team.</p>
            <p className="text-xs mt-1">You can still submit your application. Processing may take a little longer.</p>
          </div>
        )}

        <div className="space-y-2">
          <Button
            className="w-full h-12 min-h-[48px] text-base font-semibold gap-2 shadow-sm"
            onClick={handleProcessAll}
            disabled={!canContinue || processing}
          >
            {processing ? (
              <><Loader2 className="h-5 w-5 animate-spin" /> AI is processing your application...</>
            ) : (
              <><Sparkles className="h-5 w-5" /> Continue to Review</>
            )}
          </Button>
          {canContinue && !processing && (
            <p className="text-[11px] text-muted-foreground text-center">
              Press <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] font-mono">Enter</kbd> to continue
            </p>
          )}
        </div>

        {!canContinue && (
          <div className="text-center text-sm text-muted-foreground bg-muted/60 border rounded-xl p-4">
            {hasBlockedDoc
              ? <span className="text-red-600 font-medium">Remove rejected documents and upload valid ones to proceed</span>
              : isProcessing
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> AI is verifying your documents...</span>
              : !allUploaded
              ? <span>Still needed: <strong>{requiredDocs.filter(d => !uploads[d]?.file).map(d => DOC_LABELS[d as DocType]).join(", ")}{!uploads.profile?.file ? ", Profile Photo" : ""}</strong></span>
              : !allVerified
              ? <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Waiting for AI to verify all documents...</span>
              : <span>Upload all required documents to continue</span>}
          </div>
        )}
      </motion.div>
      </div>
    )
  }

  // ===== REVIEW PHASE =====
  if (phase === "review") {
    const type = selectedType || getMembershipType(formData.membershipType)!
    const fee = calculateFee(type!)

    // Smart placeholders for fields
    const PLACEHOLDERS: Record<string, string> = {
      firstName: "e.g. Rajesh",
      lastName: "e.g. Kumar",
      fatherName: "e.g. Suresh Kumar",
      mciCouncilNumber: "e.g. 2021055120",
      asiMembershipNo: "e.g. L-12345",
      imrRegNo: "e.g. 123456",
      eduPostgradDegree: "e.g. MS General Surgery",
      eduPostgradCollege: "Start typing college name...",
      eduPostgradUniversity: "e.g. MUHS Nashik",
      eduUndergradCollege: "Start typing college name...",
      eduUndergradUniversity: "e.g. RGUHS Bangalore",
      streetLine1: "House/Building, Street",
      streetLine2: "Area, Landmark",
      city: "e.g. Mumbai",
      pin: "e.g. 411001",
    }

    // Collect ALL missing required fields into one flat list
    const allErrors = { ...validatePersonalDetails(formData), ...validateEducation(formData), ...validateRegistration(formData) }
    const missingCount = Object.keys(allErrors).length

    // Track which fields were initially empty when review loaded — keep them visible while editing
    const initiallyMissingRef = useRef<Set<string> | null>(null)
    if (initiallyMissingRef.current === null) {
      initiallyMissingRef.current = new Set(Object.keys(allErrors))
    }
    const wasInitiallyMissing = (field: string) => initiallyMissingRef.current?.has(field) ?? false

    // Track all required fields for progress
    const requiredFields: { key: string; label: string }[] = [
      { key: "firstName", label: "First Name" },
      { key: "dob", label: "Date of Birth" },
      { key: "gender", label: "Gender" },
      { key: "email", label: "Email" },
      { key: "mobile", label: "Mobile" },
    ]
    if (type?.requiresPG) {
      requiredFields.push(
        { key: "eduPostgradDegree", label: "PG Degree" },
        { key: "eduPostgradCollege", label: "PG College" },
        { key: "eduPostgradUniversity", label: "PG University" },
        { key: "eduPostgradYear", label: "PG Year" },
      )
    }
    if (type?.id !== "ILM") {
      requiredFields.push({ key: "mciCouncilNumber", label: "MCI Number" })
    }
    if (type?.requiresASI) {
      requiredFields.push({ key: "asiMembershipNo", label: "ASI Number" })
    }
    const filledCount = requiredFields.filter(f => (formData as any)[f.key]).length
    const totalRequired = requiredFields.length
    const pct = Math.round((filledCount / totalRequired) * 100)

    // Filled data summary
    const filledSummary = [
      formData.salutation && formData.firstName ? `${formData.salutation} ${formData.firstName} ${formData.lastName}`.trim() : null,
      formData.email,
      formData.mobile ? `+91 ${formData.mobile}` : null,
      formData.dob,
      formData.gender,
      formData.eduPostgradDegree,
      formData.eduPostgradCollege,
      formData.mciCouncilNumber ? `MCI: ${formData.mciCouncilNumber}` : null,
      formData.city && formData.state ? `${formData.city}, ${formData.state}` : formData.state,
    ].filter(Boolean)

    return (
      <div>
      <ProgressBar currentPhase={phase} />
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        className="max-w-2xl mx-auto px-4 pt-4 space-y-4"
      >
        <button onClick={() => setPhase("upload")} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[44px]">
          <ArrowLeft className="h-4 w-4" /> Back to Upload
        </button>

        {/* Header with circular progress */}
        <Card className={pct === 100 ? "border-green-400 bg-green-50/80 dark:bg-green-500/10 dark:border-green-500/30" : "border-amber-300 bg-amber-50/80 dark:bg-amber-500/10 dark:border-amber-500/30"}>
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              {/* Circular progress indicator */}
              <div className="relative h-16 w-16 shrink-0">
                <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
                  <circle cx="32" cy="32" r="28" fill="none" strokeWidth="5" className="stroke-muted/40" />
                  <circle
                    cx="32" cy="32" r="28" fill="none" strokeWidth="5"
                    strokeLinecap="round"
                    className={pct === 100 ? "stroke-green-500" : "stroke-amber-500"}
                    strokeDasharray={`${2 * Math.PI * 28}`}
                    strokeDashoffset={`${2 * Math.PI * 28 * (1 - pct / 100)}`}
                    style={{ transition: "stroke-dashoffset 0.5s ease" }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold">{pct}%</span>
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {pct === 100 ? <CheckCircle className="h-5 w-5 text-green-600" /> : <Sparkles className="h-5 w-5 text-amber-600" />}
                  <span className="font-bold text-base">{pct === 100 ? "Ready to Submit!" : `${missingCount} field${missingCount !== 1 ? "s" : ""} needed`}</span>
                </div>
                <div className="w-full bg-muted/40 rounded-full h-2">
                  <div className={`h-2 rounded-full transition-all duration-500 ${pct === 100 ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">{filledCount} of {totalRequired} required fields complete</p>
              </div>
            </div>
            {filledSummary.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {filledSummary.map((s, i) => (
                  <span key={i} className="text-xs bg-muted/60 text-foreground px-2.5 py-0.5 rounded-full border">{s}</span>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Missing fields - compact inline form */}
        {missingCount > 0 && (
          <Card className="border-amber-200 dark:border-amber-500/30 shadow-sm">
            <CardContent className="p-5 space-y-4">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" />
                <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Fill these to complete your application</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {wasInitiallyMissing("firstName") && <StableFieldInput field="firstName" label="First Name" required value={formData.firstName || ""} error={errors.firstName} placeholder={PLACEHOLDERS.firstName || ""} isFilled={!!formData.firstName} onChange={updateField} />}
                {wasInitiallyMissing("dob") && (
                  <div>
                    <Label className="text-xs flex items-center gap-1">Date of Birth <span className="text-destructive">*</span>{formData.dob && <CheckCircle className="h-3 w-3 text-green-500" />}</Label>
                    <Input type="date" value={formData.dob} onChange={(e) => updateField("dob", e.target.value)} min="1930-01-01" max={new Date().toISOString().split("T")[0]} className={formData.dob ? "border-green-300" : ""} />
                  </div>
                )}
                {wasInitiallyMissing("gender") && (
                  <div>
                    <Label className="text-xs flex items-center gap-1">Gender <span className="text-destructive">*</span>{formData.gender && <CheckCircle className="h-3 w-3 text-green-500" />}</Label>
                    <div className="flex gap-1.5">
                      {["Male", "Female", "Other"].map((g) => (
                        <button key={g} type="button" onClick={() => updateField("gender", g)}
                          className={`flex-1 h-10 min-h-[44px] rounded-md border text-xs font-medium transition-colors ${formData.gender === g ? "bg-primary text-primary-foreground border-primary" : "bg-background border-input hover:bg-accent"}`}
                        >{g}</button>
                      ))}
                    </div>
                  </div>
                )}
                {wasInitiallyMissing("eduPostgradDegree") && type?.requiresPG && (
                  <StableSelectInput field="eduPostgradDegree" label="PG Degree" options={[
                    "MS General Surgery", "MS Obstetrics & Gynaecology",
                    "MCh Surgical Oncology", "MCh Urology", "MCh Cardiothoracic Surgery", "MCh Neurosurgery", "MCh Plastic Surgery", "MCh GI Surgery",
                    "DNB General Surgery", "DNB Obstetrics & Gynaecology", "DNB Surgical Oncology", "DNB Urology",
                    "FRCS", "MRCS",
                  ]} required value={(formData as any).eduPostgradDegree || ""} error={errors.eduPostgradDegree} isFilled={!!formData.eduPostgradDegree} onChange={updateField} />
                )}
                {wasInitiallyMissing("eduPostgradCollege") && type?.requiresPG && (
                  <div>
                    <Label className="text-xs flex items-center gap-1">PG College <span className="text-destructive">*</span>{formData.eduPostgradCollege && <CheckCircle className="h-3 w-3 text-green-500" />}</Label>
                    <Autocomplete
                      value={formData.eduPostgradCollege}
                      onChange={(v) => {
                        updateField("eduPostgradCollege", v)
                        const match = COLLEGE_OPTIONS.find(c => c.label === v)
                        if (match) {
                          updateField("eduPostgradUniversity", match.university)
                          if (!formData.state) { updateField("state", match.state); updateField("zone", STATE_TO_ZONE[match.state] || "") }
                        }
                      }}
                      options={COLLEGE_OPTIONS}
                      placeholder="Type college name..."
                    />
                  </div>
                )}
                {wasInitiallyMissing("eduPostgradUniversity") && type?.requiresPG && <StableFieldInput field="eduPostgradUniversity" label="PG University" required value={formData.eduPostgradUniversity || ""} error={errors.eduPostgradUniversity} placeholder={PLACEHOLDERS.eduPostgradUniversity || ""} isFilled={!!formData.eduPostgradUniversity} onChange={updateField} />}
                {wasInitiallyMissing("eduPostgradYear") && type?.requiresPG && <StableSelectInput field="eduPostgradYear" label="PG Year" options={YEAR_OPTIONS} required value={formData.eduPostgradYear || ""} error={errors.eduPostgradYear} isFilled={!!formData.eduPostgradYear} onChange={updateField} />}
                {wasInitiallyMissing("mciCouncilNumber") && formData.membershipType !== "ILM" && <StableFieldInput field="mciCouncilNumber" label="MCI/Council Number" required value={formData.mciCouncilNumber || ""} error={errors.mciCouncilNumber} placeholder={PLACEHOLDERS.mciCouncilNumber || ""} isFilled={!!formData.mciCouncilNumber} onChange={updateField} />}
                {wasInitiallyMissing("asiMembershipNo") && type?.requiresASI && <StableFieldInput field="asiMembershipNo" label="ASI Membership No" required value={formData.asiMembershipNo || ""} error={errors.asiMembershipNo} placeholder={PLACEHOLDERS.asiMembershipNo || ""} isFilled={!!formData.asiMembershipNo} onChange={updateField} />}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Membership Type + Fee */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center shrink-0">
                <Award className="h-5 w-5 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold truncate">{type?.name}</p>
                <p className="text-xs text-muted-foreground truncate">{type?.eligibility}</p>
              </div>
            </div>
            <p className="text-xl font-bold text-primary shrink-0">{fee.currency}{fee.totalFee.toLocaleString()}</p>
          </CardContent>
        </Card>

        {/* All sections - collapsible for editing */}
        <Card className="shadow-sm overflow-visible">
          <div className="divide-y overflow-visible">
            {/* Personal */}
            <button type="button" className="w-full flex items-center justify-between p-4 min-h-[48px] hover:bg-accent/50 transition-colors" onClick={() => setEditSection(editSection === "personal" ? null : "personal")}>
              <div className="flex items-center gap-2.5 text-sm font-semibold">
                <Users className="h-4 w-4 text-muted-foreground" /> Personal Details
                {!allErrors.firstName && !allErrors.dob && !allErrors.gender ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
              </div>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${editSection === "personal" ? "rotate-90" : ""}`} />
            </button>
            {editSection === "personal" && (
              <div className="p-4 space-y-3 bg-muted/30">
                <div className="grid gap-3 sm:grid-cols-3">
                  <StableSelectInput field="salutation" label="Salutation" options={["Dr.", "Prof.", "Mr.", "Mrs.", "Ms."]} value={formData.salutation || ""} error={errors.salutation} isFilled={!!formData.salutation} onChange={updateField} />
                  <StableFieldInput field="firstName" label="First Name" required value={formData.firstName || ""} error={errors.firstName} placeholder={PLACEHOLDERS.firstName || ""} isFilled={!!formData.firstName} onChange={updateField} />
                  <StableFieldInput field="lastName" label="Last Name" value={formData.lastName || ""} error={errors.lastName} placeholder={PLACEHOLDERS.lastName || ""} isFilled={!!formData.lastName} onChange={updateField} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <Label className="text-xs">
                      Date of Birth <span className="text-destructive">*</span>
                      {calcAge(formData.dob) && <span className="text-muted-foreground ml-1">({calcAge(formData.dob)} yrs)</span>}
                    </Label>
                    <Input type="date" value={formData.dob} onChange={(e) => updateField("dob", e.target.value)} min="1930-01-01" max={new Date().toISOString().split("T")[0]} />
                  </div>
                  <div>
                    <Label className="text-xs">Gender <span className="text-destructive">*</span></Label>
                    <div className="flex gap-1.5 mt-0.5">
                      {["Male", "Female", "Other"].map((g) => (
                        <button key={g} type="button" onClick={() => updateField("gender", g)}
                          className={`flex-1 h-9 rounded-md border text-xs font-medium ${formData.gender === g ? "bg-primary text-primary-foreground" : "border-input hover:bg-accent"}`}
                        >{g}</button>
                      ))}
                    </div>
                  </div>
                  <StableFieldInput field="fatherName" label="Father's Name" value={formData.fatherName || ""} error={errors.fatherName} placeholder={PLACEHOLDERS.fatherName || ""} isFilled={!!formData.fatherName} onChange={updateField} />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Email {emailVerified && <span className="text-green-600">✓ Verified</span>}</Label>
                    <Input value={formData.email} readOnly className="bg-muted" />
                  </div>
                  <div>
                    <Label className="text-xs">Mobile</Label>
                    <Input value={formData.mobile} readOnly className="bg-muted" />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground font-medium">Address — enter PIN to auto-fill</p>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div>
                    <Label className="text-xs">PIN Code</Label>
                    <Input value={formData.pin} onChange={async (e) => {
                      const pin = e.target.value.replace(/\D/g, "").slice(0, 6); updateField("pin", pin)
                      if (pin.length === 6) { try { const r = await fetch(`/api/pincode?pin=${pin}`); const d = await r.json(); if (d.status) { if (d.city) updateField("city", d.city); if (d.state) { const m = INDIAN_STATES.find(s => s.toLowerCase() === d.state.toLowerCase()); if (m) { updateField("state", m); updateField("zone", STATE_TO_ZONE[m] || "") } } } } catch {} }
                    }} placeholder="6-digit" maxLength={6} />
                  </div>
                  <StableFieldInput field="city" label="City" value={formData.city || ""} error={errors.city} placeholder={PLACEHOLDERS.city || ""} isFilled={!!formData.city} onChange={updateField} />
                  <StableSelectInput field="state" label="State" options={INDIAN_STATES} value={formData.state || ""} error={errors.state} isFilled={!!formData.state} onChange={updateField} />
                  <div><Label className="text-xs">Zone</Label><Input value={formData.zone} disabled className="bg-muted" /></div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <StableFieldInput field="streetLine1" label="Street Line 1" value={formData.streetLine1 || ""} error={errors.streetLine1} placeholder={PLACEHOLDERS.streetLine1 || ""} isFilled={!!formData.streetLine1} onChange={updateField} />
                  <StableFieldInput field="streetLine2" label="Street Line 2" value={formData.streetLine2 || ""} error={errors.streetLine2} placeholder={PLACEHOLDERS.streetLine2 || ""} isFilled={!!formData.streetLine2} onChange={updateField} />
                </div>
              </div>
            )}

            {/* Education */}
            <button type="button" className="w-full flex items-center justify-between p-4 min-h-[48px] hover:bg-accent/50 transition-colors" onClick={() => setEditSection(editSection === "education" ? null : "education")}>
              <div className="flex items-center gap-2.5 text-sm font-semibold">
                <GraduationCap className="h-4 w-4 text-muted-foreground" /> Education
                {!allErrors.eduPostgradDegree && !allErrors.eduPostgradCollege && !allErrors.eduPostgradUniversity && !allErrors.eduPostgradYear ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
              </div>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${editSection === "education" ? "rotate-90" : ""}`} />
            </button>
            {editSection === "education" && (
              <div className="p-4 space-y-3 bg-muted/30 overflow-visible">
                {type?.requiresPG && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">Postgraduate</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <StableFieldInput field="eduPostgradDegree" label="Degree" required value={formData.eduPostgradDegree || ""} error={errors.eduPostgradDegree} placeholder={PLACEHOLDERS.eduPostgradDegree || ""} isFilled={!!formData.eduPostgradDegree} onChange={updateField} />
                      <div>
                        <Label className="text-xs">College <span className="text-destructive">*</span></Label>
                        <Autocomplete
                          value={formData.eduPostgradCollege}
                          onChange={(v) => {
                            updateField("eduPostgradCollege", v)
                            const match = COLLEGE_OPTIONS.find(c => c.label === v)
                            if (match) {
                              updateField("eduPostgradUniversity", match.university)
                              if (!formData.state) { updateField("state", match.state); updateField("zone", STATE_TO_ZONE[match.state] || "") }
                            }
                          }}
                          options={COLLEGE_OPTIONS}
                          placeholder="Type college name..."
                        />
                      </div>
                      <StableFieldInput field="eduPostgradUniversity" label="University" required value={formData.eduPostgradUniversity || ""} error={errors.eduPostgradUniversity} placeholder={PLACEHOLDERS.eduPostgradUniversity || ""} isFilled={!!formData.eduPostgradUniversity} onChange={updateField} />
                      <StableSelectInput field="eduPostgradYear" label="Year" options={YEAR_OPTIONS} required value={formData.eduPostgradYear || ""} error={errors.eduPostgradYear} isFilled={!!formData.eduPostgradYear} onChange={updateField} />
                    </div>
                  </>
                )}
                {type?.requiresMBBS && (
                  <>
                    <p className="text-xs font-medium text-muted-foreground">MBBS / Undergraduate</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label className="text-xs">College <span className="text-destructive">*</span></Label>
                        <Autocomplete
                          value={formData.eduUndergradCollege}
                          onChange={(v) => {
                            updateField("eduUndergradCollege", v)
                            const match = COLLEGE_OPTIONS.find(c => c.label === v)
                            if (match) updateField("eduUndergradUniversity", match.university)
                          }}
                          options={COLLEGE_OPTIONS}
                          placeholder="Type college name..."
                        />
                      </div>
                      <StableFieldInput field="eduUndergradUniversity" label="University" required value={formData.eduUndergradUniversity || ""} error={errors.eduUndergradUniversity} placeholder={PLACEHOLDERS.eduUndergradUniversity || ""} isFilled={!!formData.eduUndergradUniversity} onChange={updateField} />
                      <StableSelectInput field="eduUndergradYear" label="Year" options={YEAR_OPTIONS} required value={formData.eduUndergradYear || ""} error={errors.eduUndergradYear} isFilled={!!formData.eduUndergradYear} onChange={updateField} />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Registration */}
            <button type="button" className="w-full flex items-center justify-between p-4 min-h-[48px] hover:bg-accent/50 transition-colors" onClick={() => setEditSection(editSection === "registration" ? null : "registration")}>
              <div className="flex items-center gap-2.5 text-sm font-semibold">
                <Stethoscope className="h-4 w-4 text-muted-foreground" /> Registration
                {!allErrors.mciCouncilNumber && !allErrors.asiMembershipNo ? <CheckCircle className="h-4 w-4 text-green-500" /> : <AlertCircle className="h-4 w-4 text-amber-500" />}
              </div>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${editSection === "registration" ? "rotate-90" : ""}`} />
            </button>
            {editSection === "registration" && (
              <div className="p-4 space-y-3 bg-muted/30">
                {formData.membershipType !== "ILM" && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">MCI/Council Number <span className="text-destructive">*</span><FieldHelp text={FIELD_HELP.mciCouncilNumber} /></Label>
                      <Input value={formData.mciCouncilNumber} onChange={(e) => updateField("mciCouncilNumber", e.target.value)} className={errors.mciCouncilNumber ? "border-destructive" : ""} />
                    </div>
                    <StableSelectInput field="mciCouncilState" label="Council State" options={INDIAN_STATES} required value={formData.mciCouncilState || ""} error={errors.mciCouncilState} isFilled={!!formData.mciCouncilState} onChange={updateField} />
                  </div>
                )}
                {type?.requiresASI && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">ASI Membership No <span className="text-destructive">*</span><FieldHelp text={FIELD_HELP.asiMembershipNo} /></Label>
                      <Input value={formData.asiMembershipNo} onChange={(e) => updateField("asiMembershipNo", e.target.value)} className={errors.asiMembershipNo ? "border-destructive" : ""} />
                    </div>
                    <StableSelectInput field="asiState" label="ASI State" options={INDIAN_STATES} value={formData.asiState || ""} error={errors.asiState} isFilled={!!formData.asiState} onChange={updateField} />
                  </div>
                )}
                <StableFieldInput field="imrRegNo" label="IMR Registration Number (Optional)" value={formData.imrRegNo || ""} error={errors.imrRegNo} placeholder={PLACEHOLDERS.imrRegNo || ""} isFilled={!!formData.imrRegNo} onChange={updateField} />
              </div>
            )}
          </div>
        </Card>

        {/* Work Experience - kept as before but below */}
        <Card>
          <button type="button" className="w-full flex items-center justify-between p-4 min-h-[48px] hover:bg-accent/50 transition-colors" onClick={() => setEditSection(editSection === "experience" ? null : "experience")}>
            <div className="flex items-center gap-2.5 text-sm font-semibold">
              <GraduationCap className="h-4 w-4 text-muted-foreground" /> Work Experience <span className="text-xs font-normal text-muted-foreground">(Optional)</span>
            </div>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${editSection === "experience" ? "rotate-90" : ""}`} />
          </button>
          {editSection === "experience" && (
            <div className="p-4 space-y-3 bg-muted/30">
          {formData.experience.map((exp, i) => (
            <div key={i} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Experience #{i + 1}</p>
                <button type="button" onClick={() => {
                  const updated = formData.experience.filter((_, idx) => idx !== i)
                  setFormData(prev => ({ ...prev, experience: updated }))
                }} className="text-xs text-destructive hover:underline">Remove</button>
              </div>
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <Label className="text-xs">Position</Label>
                  <Input value={exp.position} onChange={(e) => {
                    const updated = [...formData.experience]
                    updated[i] = { ...updated[i], position: e.target.value }
                    setFormData(prev => ({ ...prev, experience: updated }))
                  }} placeholder="e.g., Consultant Surgeon" />
                </div>
                <div>
                  <Label className="text-xs">From</Label>
                  <Input type="date" value={exp.from} onChange={(e) => {
                    const updated = [...formData.experience]
                    updated[i] = { ...updated[i], from: e.target.value }
                    setFormData(prev => ({ ...prev, experience: updated }))
                  }} />
                </div>
                <div>
                  <Label className="text-xs">To</Label>
                  <Input type="date" value={exp.to} onChange={(e) => {
                    const updated = [...formData.experience]
                    updated[i] = { ...updated[i], to: e.target.value }
                    setFormData(prev => ({ ...prev, experience: updated }))
                  }} />
                </div>
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFormData(prev => ({
              ...prev,
              experience: [...prev.experience, { position: "", from: "", to: "", years: "" }]
            }))}
          >
            + Add Experience
          </Button>
            </div>
          )}
        </Card>

        {/* Documents Summary */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileCheck className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">Uploaded Documents</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(uploads).map(([key, upload]) => (
                <div key={key} className="flex items-center gap-2 bg-muted/50 rounded-lg p-2">
                  <div className="h-10 w-10 rounded bg-muted flex items-center justify-center overflow-hidden shrink-0">
                    {upload.file?.type?.startsWith("image/") ? (
                      <img src={upload.preview} alt="" className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none" }} />
                    ) : (
                      <FileCheck className="h-4 w-4 text-primary" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{DOC_LABELS[key as DocType] || "Profile Photo"}</p>
                    <p className="text-xs text-success flex items-center gap-1">
                      <CheckCircle className="h-3 w-3" />
                      {upload.status === "extracted" ? `${Object.keys(upload.extracted).length} fields extracted` : "Uploaded"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Fee */}
        <Card className="bg-muted/20 border">
          <CardContent className="p-5">
            <div className="flex items-center justify-between text-sm py-1">
              <span className="text-muted-foreground">Membership Fee</span>
              <span className="font-medium">{fee.currency}{fee.baseFee.toLocaleString()}</span>
            </div>
            {fee.processingFee > 0 && (
              <div className="flex items-center justify-between text-sm text-muted-foreground py-1">
                <span>Processing Fee (incl. GST)</span>
                <span>{fee.currency}{fee.processingFee.toLocaleString()}</span>
              </div>
            )}
            <div className="flex items-center justify-between font-bold text-lg border-t mt-3 pt-3">
              <span>Total</span>
              <span className="text-primary">{fee.currency}{fee.totalFee.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        {/* Terms & Conditions */}
        <label className={`flex items-start gap-3 cursor-pointer p-4 rounded-xl border-2 transition-colors ${termsAccepted ? "border-primary/30 bg-primary/5" : "border-border hover:bg-accent/50"}`}>
          <input
            type="checkbox"
            checked={termsAccepted}
            onChange={(e) => setTermsAccepted(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <span className="text-sm text-muted-foreground leading-relaxed">
            I confirm that all information provided is accurate. I agree to the{" "}
            <a href="https://www.amasi.org/terms" target="_blank" rel="noopener noreferrer" className="text-primary font-medium underline underline-offset-2 hover:text-primary/80">
              terms and conditions
            </a>{" "}
            of AMASI membership and authorize verification of my documents.
          </span>
        </label>

        {/* Show what's blocking submission */}
        {missingCount > 0 && (
          <div className="text-center text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="font-semibold">Cannot submit yet — {missingCount} required field{missingCount !== 1 ? "s" : ""} missing</p>
            <p className="text-xs mt-1.5 text-amber-600">{Object.values(allErrors).join(" &bull; ")}</p>
          </div>
        )}

        <div className="space-y-2">
          <Button className="w-full h-13 min-h-[48px] text-base font-bold gap-2 shadow-md" onClick={handleSubmit} disabled={submitting || !termsAccepted || missingCount > 0}>
            {submitting ? <><Loader2 className="h-5 w-5 animate-spin" /> Processing Payment...</> : <><Send className="h-5 w-5" /> Pay {fee.currency}{fee.totalFee.toLocaleString()} &amp; Submit</>}
          </Button>
          {!submitting && termsAccepted && missingCount === 0 && (
            <p className="text-[11px] text-muted-foreground text-center">
              Press <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] font-mono">Ctrl</kbd> + <kbd className="px-1.5 py-0.5 rounded bg-muted border text-[10px] font-mono">Enter</kbd> to submit
            </p>
          )}
        </div>
      </motion.div>
      </div>
    )
  }

  // Copy to clipboard helper
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      toast.success("Copied to clipboard")
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // ===== CONFIRM (Payment processing) =====
  if (phase === "confirm") {
    return (
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <ProgressBar currentPhase={phase} />
        <div className="text-center space-y-4">
          <Loader2 className="h-10 w-10 animate-spin mx-auto text-primary" />
          <h2 className="text-xl font-bold">Processing payment...</h2>
          <p className="text-muted-foreground text-sm">Please do not close this window.</p>
        </div>
      </div>
    )
  }

  // ===== SUCCESS =====
  if (phase === "success") {
    const displayRef = approvalResult?.approved ? String(approvalResult.amasiNumber) : refNumber
    return (
      <div className="max-w-lg mx-auto px-4 py-8 sm:py-12">
        <ProgressBar currentPhase={phase} />
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center"
        >
          {/* Animated checkmark */}
          <div className="relative h-24 w-24 mx-auto mb-6">
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.2 }}
              className={`h-24 w-24 rounded-full flex items-center justify-center ${approvalResult?.approved ? "bg-green-100" : "bg-amber-100"}`}
            >
              <svg
                className={`h-14 w-14 ${approvalResult?.approved ? "text-green-500" : "text-amber-500"}`}
                viewBox="0 0 52 52"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <motion.circle
                  cx="26" cy="26" r="24"
                  stroke="currentColor" strokeWidth="3" fill="none"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                />
                <motion.path
                  d="M14 27l7 7 16-16"
                  stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none"
                  initial={{ pathLength: 0 }}
                  animate={{ pathLength: 1 }}
                  transition={{ duration: 0.4, delay: 0.7 }}
                />
              </svg>
            </motion.div>
          </div>

          {approvalResult?.approved ? (
            <>
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-2xl sm:text-3xl font-bold mb-2 text-green-800"
              >
                Welcome to AMASI!
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-muted-foreground mb-5"
              >
                Your membership has been approved instantly.
              </motion.p>
            </>
          ) : (
            <>
              <motion.h2
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="text-2xl sm:text-3xl font-bold mb-2"
              >
                Application Submitted!
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                className="text-muted-foreground mb-5"
              >
                Payment received. Your application is under review.
              </motion.p>
            </>
          )}

          {/* Reference / Membership Number with copy button */}
          {displayRef && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className={`rounded-2xl p-6 mb-6 mx-auto max-w-sm border-2 ${approvalResult?.approved ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"}`}
            >
              <p className={`text-xs font-semibold uppercase tracking-wider mb-2 ${approvalResult?.approved ? "text-green-600" : "text-amber-600"}`}>
                {approvalResult?.approved ? "Your AMASI Membership Number" : "Reference Number"}
              </p>
              <div className="flex items-center justify-center gap-3">
                <p className={`text-3xl sm:text-4xl font-bold font-mono ${approvalResult?.approved ? "text-green-800" : "text-amber-800"}`}>
                  {displayRef}
                </p>
                <button
                  onClick={() => copyToClipboard(displayRef)}
                  className={`h-9 w-9 rounded-lg flex items-center justify-center transition-colors min-h-[44px] min-w-[44px] ${
                    copied
                      ? "bg-green-200 text-green-700"
                      : approvalResult?.approved
                        ? "bg-green-200/60 text-green-700 hover:bg-green-200"
                        : "bg-amber-200/60 text-amber-700 hover:bg-amber-200"
                  }`}
                  title="Copy to clipboard"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              {approvalResult?.approved && (
                <p className="text-sm text-green-600 mt-3 font-medium">{selectedType?.name}</p>
              )}
              {!approvalResult?.approved && (
                <div className="flex items-center justify-center gap-1.5 mt-3 text-amber-600">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Under Admin Review</span>
                </div>
              )}
            </motion.div>
          )}

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="text-sm text-muted-foreground mb-8"
          >
            {approvalResult?.approved
              ? <>Confirmation and membership details have been sent to <strong className="text-foreground">{formData.email}</strong>.</>
              : <>You&apos;ll receive an email at <strong className="text-foreground">{formData.email}</strong> once approved.</>
            }
          </motion.p>

          {/* What happens next? Timeline */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7 }}
          >
            <Card className="text-left mb-6 shadow-sm">
              <CardContent className="p-5">
                <h3 className="font-semibold text-sm mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-primary" />
                  What happens next?
                </h3>
                <div className="space-y-0">
                  {[
                    {
                      title: "Application Review",
                      desc: approvalResult?.approved ? "Completed" : "1-2 business days",
                      done: !!approvalResult?.approved,
                      active: !approvalResult?.approved,
                    },
                    {
                      title: "Approval",
                      desc: approvalResult?.approved ? "Approved" : "After document verification",
                      done: !!approvalResult?.approved,
                      active: false,
                    },
                    {
                      title: "Membership Number Assigned",
                      desc: approvalResult?.approved ? `AMASI ${approvalResult.amasiNumber}` : "Upon approval",
                      done: !!approvalResult?.approved,
                      active: false,
                    },
                  ].map((step, i, arr) => (
                    <div key={i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className={`h-7 w-7 rounded-full flex items-center justify-center shrink-0 ${
                          step.done ? "bg-green-500" : step.active ? "bg-primary ring-2 ring-primary/30 ring-offset-1" : "bg-muted"
                        }`}>
                          {step.done ? (
                            <Check className="h-3.5 w-3.5 text-white" />
                          ) : step.active ? (
                            <Loader2 className="h-3.5 w-3.5 text-primary-foreground animate-spin" />
                          ) : (
                            <span className="text-xs text-muted-foreground font-medium">{i + 1}</span>
                          )}
                        </div>
                        {i < arr.length - 1 && (
                          <div className={`w-0.5 h-8 ${step.done ? "bg-green-300" : "bg-muted"}`} />
                        )}
                      </div>
                      <div className="pb-6">
                        <p className={`text-sm font-semibold ${step.done ? "text-green-700" : step.active ? "text-foreground" : "text-muted-foreground"}`}>
                          {step.title}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{step.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>

          {/* Action buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="space-y-3"
          >
            <Button className="w-full h-12 min-h-[44px] font-semibold gap-2" onClick={() => window.location.href = `/apply/status?ref=${refNumber}`}>
              <FileText className="h-4 w-4" /> Track Application Status
            </Button>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="h-11 min-h-[44px] text-sm gap-1.5" onClick={() => {
                // Generate a simple receipt URL / open print dialog
                window.print()
              }}>
                <FileCheck className="h-4 w-4" /> Download Receipt
              </Button>
              <Button variant="outline" className="h-11 min-h-[44px] text-sm gap-1.5" onClick={() => window.open("https://www.amasi.org", "_blank")}>
                <ExternalLink className="h-4 w-4" /> AMASI Website
              </Button>
            </div>
          </motion.div>
        </motion.div>
      </div>
    )
  }

  return null
}
