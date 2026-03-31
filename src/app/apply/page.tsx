"use client"

import { useState, useCallback, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Upload, FileCheck, Sparkles, CheckCircle, AlertCircle, Loader2,
  ArrowRight, ArrowLeft, Send, Shield, Award, Clock, Users, Star,
  ChevronRight, X, Eye, GraduationCap, Stethoscope,
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

type Phase = "check" | "existing" | "landing" | "upload" | "review" | "confirm" | "success"
type UploadEntry = {
  file: File
  preview: string
  status: "processing" | "extracted" | "uploaded" | "rejected" | "blocked"
  extracted: Record<string, any>
  eligibility?: { eligible: boolean; reason: string } | null
  message?: string
}

export default function ApplyPage() {
  const [phase, setPhase] = useState<Phase>("check")
  const [checkQuery, setCheckQuery] = useState("")
  const [checking, setChecking] = useState(false)
  const [existingMember, setExistingMember] = useState<MemberData | null>(null)
  const [formData, setFormData] = useState<ApplicationFormData>(INITIAL_FORM_DATA)
  const [uploads, setUploads] = useState<Record<string, UploadEntry>>({})
  const [processing, setProcessing] = useState(false)
  const [selectedType, setSelectedType] = useState<MembershipType | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [editSection, setEditSection] = useState<string | null>(null)

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

      // Reject irrelevant documents
      if (result.isIrrelevant || !result.success) {
        URL.revokeObjectURL(preview)
        setUploads((prev) => { const c = { ...prev }; delete c[docType]; return c })
        toast.error(result.message || result.error || "This doesn't appear to be a valid medical document.")
        return
      }

      const extracted = result.extracted || {}

      // Check eligibility for PG degree
      if (result.eligibility && !result.eligibility.eligible) {
        setUploads((prev) => ({
          ...prev,
          [docType]: { file, preview, status: "blocked", extracted, eligibility: result.eligibility, message: result.eligibility.reason },
        }))
        toast.error(result.eligibility.reason)
        return
      }

      // Auto-fill form fields from extracted data
      const updates: Partial<ApplicationFormData> = {}
      if (extracted.name) {
        const cleanName = extracted.name
          .replace(/^(Dr\.?|Prof\.?|Mr\.?|Mrs\.?|Ms\.?|Shri\.?)\s*/gi, "")
          .replace(/\s+/g, " ")
          .trim()

        // Validate: reject garbage text (must look like a real name)
        const junkWords = ["the", "of", "and", "for", "this", "that", "with", "from", "qualification", "certificate", "registration", "additional", "medical", "council", "not visible", "null", "n/a"]
        const nameParts = cleanName.split(/\s+/)
        const isValidName = nameParts.length >= 1 &&
          nameParts.length <= 5 &&
          cleanName.length >= 3 &&
          cleanName.length <= 60 &&
          !junkWords.includes(nameParts[0].toLowerCase()) &&
          /^[A-Za-z]/.test(nameParts[0])

        if (isValidName) {
          if (nameParts[0]) updates.firstName = nameParts[0]
          if (nameParts.length === 2) updates.lastName = nameParts[1]
          if (nameParts.length >= 3) {
            updates.middleName = nameParts[1]
            updates.lastName = nameParts.slice(2).join(" ")
          }
        }
      }
      if (extracted.registration_number) updates.mciCouncilNumber = extracted.registration_number
      if (extracted.council_state) {
        const state = extracted.council_state.replace(/\s*(medical|council|state)\s*/gi, "").trim()
        const matchedState = INDIAN_STATES.find(s => extracted.council_state.toLowerCase().includes(s.toLowerCase()))
        if (matchedState) {
          updates.mciCouncilState = matchedState
          updates.state = matchedState
          updates.zone = STATE_TO_ZONE[matchedState] || ""
        }
      }
      if (extracted.date_of_birth) updates.dob = extracted.date_of_birth
      if (extracted.gender) updates.gender = extracted.gender
      if (extracted.father_name) updates.fatherName = extracted.father_name.replace(/^(Mr\.?|Shri\.?|Late\.?)\s*/i, "").trim()
      if (extracted.degree) {
        if (docType === "pg_degree_certificate") updates.eduPostgradDegree = extracted.degree
        else updates.eduUndergradDegree = extracted.degree
      }
      if (extracted.university) {
        if (docType === "pg_degree_certificate") updates.eduPostgradUniversity = extracted.university
        else updates.eduUndergradUniversity = extracted.university
      }
      if (extracted.college) {
        if (docType === "pg_degree_certificate") updates.eduPostgradCollege = extracted.college
        else updates.eduUndergradCollege = extracted.college
      }
      if (extracted.year_of_passing) {
        if (docType === "pg_degree_certificate") updates.eduPostgradYear = String(extracted.year_of_passing)
        else updates.eduUndergradYear = String(extracted.year_of_passing)
      }
      if (extracted.asi_membership_number) updates.asiMembershipNo = extracted.asi_membership_number

      if (Object.keys(updates).length > 0) {
        setFormData((prev) => ({ ...prev, ...updates }))
      }

      // Name cross-check between documents
      let nameWarning = ""
      if (extracted.name) {
        const otherDocs = Object.entries(uploads).filter(([key]) => key !== docType && key !== "profile")
        for (const [, otherUpload] of otherDocs) {
          if (otherUpload.extracted?.name) {
            const name1 = extracted.name.toLowerCase().replace(/^(dr\.?|prof\.?)\s*/i, "").trim()
            const name2 = otherUpload.extracted.name.toLowerCase().replace(/^(dr\.?|prof\.?)\s*/i, "").trim()
            const firstName1 = name1.split(/\s+/)[0]
            const firstName2 = name2.split(/\s+/)[0]
            if (firstName1 !== firstName2) {
              nameWarning = `Name mismatch: "${extracted.name}" on this document vs "${otherUpload.extracted.name}" on another document. Please ensure all documents belong to the same person.`
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

      toast.success(`${DOC_LABELS[docType as DocType]}: extracted ${fieldCount} fields`)
    } catch (err: any) {
      setUploads((prev) => ({
        ...prev,
        [docType]: { file, preview, status: "uploaded", extracted: {}, message: "OCR failed - please try again" },
      }))
      toast.error("Failed to process document. Please try again.")
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
  }

  const handleSubmit = () => {
    const personalErrors = validatePersonalDetails(formData)
    const eduErrors = validateEducation(formData)
    const regErrors = validateRegistration(formData)
    const allErrors = { ...personalErrors, ...eduErrors, ...regErrors }

    if (Object.keys(allErrors).length > 0) {
      setErrors(allErrors)
      toast.error("Please fill in the required fields highlighted in red")
      return
    }
    setPhase("success")
    toast.success("Application submitted!")
  }

  const updateField = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (field === "state") {
      setFormData((prev) => ({ ...prev, zone: STATE_TO_ZONE[value] || "" }))
    }
    setErrors((prev) => {
      const copy = { ...prev }
      delete copy[field]
      return copy
    })
  }

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
        // Not found — prefill email/phone and proceed to apply
        const isEmail = checkQuery.includes("@")
        setFormData((prev) => ({
          ...prev,
          email: isEmail ? checkQuery.trim() : prev.email,
          mobile: !isEmail ? checkQuery.trim() : prev.mobile,
        }))
        toast.info("No existing membership found. Let's create your application!")
        setPhase("landing")
      }
    } catch {
      toast.error("Could not check membership. Please try again.")
    }
    setChecking(false)
  }

  // ===== CHECK PHASE =====
  if (phase === "check") {
    return (
      <div className="max-w-lg mx-auto py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Stethoscope className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold mb-2">AMASI Membership</h1>
          <p className="text-muted-foreground">
            Association of Minimal Access Surgeons of India
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
        >
          <Card>
            <CardContent className="pt-6">
              <h2 className="font-semibold text-lg mb-1">Let&apos;s check your membership</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Enter your email or phone number to check if you already have an AMASI membership.
              </p>
              <form onSubmit={handleCheckMembership} className="space-y-4">
                <Input
                  placeholder="Enter email address or mobile number"
                  value={checkQuery}
                  onChange={(e) => setCheckQuery(e.target.value)}
                  className="h-12 text-base"
                  autoFocus
                />
                <Button type="submit" className="w-full h-12 text-base gap-2" disabled={checking || !checkQuery.trim()}>
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
          className="grid gap-4 md:grid-cols-3 mt-8 text-center"
        >
          {[
            { icon: Shield, label: "18,000+ Members" },
            { icon: Award, label: "35+ Years" },
            { icon: Clock, label: "2 Min to Apply" },
          ].map((item, i) => (
            <div key={i} className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <item.icon className="h-4 w-4 text-primary" />
              {item.label}
            </div>
          ))}
        </motion.div>
      </div>
    )
  }

  // ===== EXISTING MEMBER PHASE =====
  if (phase === "existing" && existingMember) {
    const m = existingMember
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-lg mx-auto py-12"
      >
        <Card>
          <CardContent className="pt-6 text-center">
            <div className="h-16 w-16 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-success" />
            </div>
            <h2 className="text-xl font-bold mb-1">You&apos;re already a member!</h2>
            <p className="text-muted-foreground text-sm mb-6">
              We found your AMASI membership. Here are your details:
            </p>

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
                <span className="text-muted-foreground">Application No</span>
                <span>{m.application_no}</span>
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
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Mobile</span>
                <span>{m.mobile_code} {m.mobile}</span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <Button variant="outline" className="w-full" onClick={() => { setExistingMember(null); setCheckQuery(""); setPhase("check") }}>
                Check Another
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => window.location.href = "/"}>
                Go to Dashboard
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
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center py-12"
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
          className="grid gap-4 md:grid-cols-3 mb-12"
        >
          {[
            { icon: Upload, title: "Upload Documents", desc: "Drop your MCI certificate and degree" },
            { icon: Sparkles, title: "AI Extracts Details", desc: "Name, registration, education — auto-filled" },
            { icon: CheckCircle, title: "Review & Submit", desc: "Verify, pay, and you're a member" },
          ].map((item, i) => (
            <Card key={i} className="text-center border-2 hover:border-primary/30 transition-colors">
              <CardContent className="pt-6">
                <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <item.icon className="h-6 w-6 text-primary" />
                </div>
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 mb-12"
        >
          {MEMBERSHIP_TYPES.map((type) => {
            const fee = calculateFee(type)
            return (
              <button
                key={type.id}
                onClick={() => {
                  setSelectedType(type)
                  setFormData((prev) => ({ ...prev, membershipType: type.id }))
                  setPhase("upload")
                }}
                className="group rounded-xl border-2 p-5 text-left transition-all hover:border-primary hover:shadow-lg"
              >
                <div className="flex items-center justify-between mb-3">
                  <Badge variant="secondary" className="text-xs">{type.shortName}</Badge>
                  <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <h3 className="font-semibold mb-1">{type.name}</h3>
                <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{type.eligibility}</p>
                <p className="text-lg font-bold text-primary">
                  {fee.currency}{fee.totalFee.toLocaleString()}
                </p>
                {type.votingRights && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-primary">
                    <Star className="h-3 w-3" /> Voting Rights
                  </div>
                )}
              </button>
            )
          })}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="grid gap-6 md:grid-cols-4 text-center py-8 border-t"
        >
          {[
            { icon: Users, value: "18,000+", label: "Members" },
            { icon: Shield, value: "35+", label: "Years" },
            { icon: Award, value: "Pan India", label: "Network" },
            { icon: Clock, value: "2 min", label: "To Apply" },
          ].map((stat, i) => (
            <div key={i}>
              <stat.icon className="h-5 w-5 mx-auto text-primary mb-1" />
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    )
  }

  // ===== UPLOAD PHASE =====
  if (phase === "upload") {
    const type = selectedType || getMembershipType(formData.membershipType)
    const requiredDocs = type?.requiredDocs.filter((d) => d !== "profile") || []
    const allUploaded = requiredDocs.every((d) => uploads[d]?.file) && uploads.profile?.file
    const allVerified = requiredDocs.every((d) => uploads[d]?.status === "extracted")
    const hasBlockedDoc = Object.values(uploads).some((u) => u.status === "blocked")
    const isProcessing = Object.values(uploads).some((u) => u.status === "processing")
    const canContinue = allUploaded && allVerified && !hasBlockedDoc && !isProcessing

    return (
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        className="max-w-2xl mx-auto space-y-6"
      >
        <button
          onClick={() => setPhase("landing")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <div className="text-center">
          <Badge className="mb-3">{type?.name}</Badge>
          <h2 className="text-2xl font-bold">Upload Your Documents</h2>
          <p className="text-muted-foreground text-sm mt-1">
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
                ) : (
                  <div className="rounded-xl border-2 border-primary/30 bg-primary/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="h-16 w-16 rounded-lg border bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                        {upload.file?.type?.startsWith("image/") ? (
                          <img src={upload.preview} alt={label} className="h-full w-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).parentElement!.innerHTML = '<div class="flex items-center justify-center h-full w-full"><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-primary"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m9 15 2 2 4-4"/></svg></div>' }} />
                        ) : (
                          <FileCheck className="h-6 w-6 text-primary" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <p className="font-medium text-sm">{label}</p>
                          <button onClick={() => handleRemoveFile(docType)} className="p-1 hover:bg-accent rounded">
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
                            <div className="flex items-center gap-1 text-sm text-success mb-1">
                              <Sparkles className="h-3 w-3" />
                              <span className="font-medium">{upload.message || "Document verified"}</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {Object.entries(upload.extracted || {}).filter(([k, v]) => v && k !== "is_valid_medical_document").map(([key, val]) => (
                                <span key={key} className="text-xs bg-success/10 text-success px-2 py-0.5 rounded-full">
                                  {key}: {String(val).slice(0, 40)}
                                </span>
                              ))}
                            </div>
                            {upload.eligibility?.eligible && (
                              <div className="flex items-center gap-1 text-xs text-success mt-1">
                                <CheckCircle className="h-3 w-3" />
                                <span>{upload.eligibility.reason}</span>
                              </div>
                            )}
                          </div>
                        )}
                        {upload.status === "blocked" && (
                          <div className="mt-2 p-2 bg-destructive/10 rounded text-sm text-destructive">
                            <div className="flex items-center gap-1 font-medium">
                              <AlertCircle className="h-4 w-4" /> Not Eligible
                            </div>
                            <p className="text-xs mt-1">{upload.message}</p>
                          </div>
                        )}
                        {upload.status === "uploaded" && (
                          <p className="text-xs text-warning mt-1">Uploaded — waiting for verification</p>
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
                  <button onClick={() => handleRemoveFile("profile")} className="p-1 hover:bg-accent rounded">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </motion.div>
        </div>

        <Button
          className="w-full h-12 text-base gap-2"
          onClick={handleProcessAll}
          disabled={!canContinue || processing}
        >
          {processing ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" /> AI is processing your application...
            </>
          ) : (
            <>
              <Sparkles className="h-5 w-5" /> Continue to Review
            </>
          )}
        </Button>

        {!canContinue && (
          <p className="text-center text-xs text-muted-foreground">
            {hasBlockedDoc
              ? "One or more documents failed eligibility check. Please upload valid documents."
              : isProcessing
              ? "Please wait while we verify your documents..."
              : !allUploaded
              ? "Upload all required documents to continue"
              : !allVerified
              ? "All documents must be verified by AI before you can continue"
              : "Upload all required documents to continue"}
          </p>
        )}
      </motion.div>
    )
  }

  // ===== REVIEW PHASE =====
  if (phase === "review") {
    const type = selectedType || getMembershipType(formData.membershipType)!
    const fee = calculateFee(type!)

    const FieldInput = ({ field, label, required }: { field: string; label: string; required?: boolean }) => (
      <div>
        <Label className="text-xs">
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
        <Input
          value={(formData as any)[field] || ""}
          onChange={(e) => updateField(field, e.target.value)}
          className={errors[field] ? "border-destructive" : ""}
        />
        {errors[field] && <p className="text-xs text-destructive mt-0.5">{errors[field]}</p>}
      </div>
    )

    const SelectInput = ({ field, label, options, required }: { field: string; label: string; options: readonly string[]; required?: boolean }) => (
      <div>
        <Label className="text-xs">
          {label} {required && <span className="text-destructive">*</span>}
        </Label>
        <select
          className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${errors[field] ? "border-destructive" : "border-input"}`}
          value={(formData as any)[field] || ""}
          onChange={(e) => updateField(field, e.target.value)}
        >
          <option value="">Select...</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
        {errors[field] && <p className="text-xs text-destructive mt-0.5">{errors[field]}</p>}
      </div>
    )

    const Section = ({ id, title, icon: Icon, children }: { id: string; title: string; icon: React.ElementType; children: React.ReactNode }) => (
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="overflow-hidden">
          <button
            type="button"
            className="w-full flex items-center justify-between p-4 hover:bg-accent/50 transition-colors"
            onClick={() => setEditSection(editSection === id ? null : id)}
          >
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-primary" />
              <h3 className="font-semibold text-sm">{title}</h3>
            </div>
            <ChevronRight className={`h-4 w-4 transition-transform ${editSection === id ? "rotate-90" : ""}`} />
          </button>
          <AnimatePresence>
            {editSection === id && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="p-4 pt-0 space-y-3 border-t">
                  {children}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {editSection !== id && (
            <div className="px-4 pb-3">
              <div className="flex flex-wrap gap-2">
                {Object.entries(formData)
                  .filter(([key, val]) => {
                    if (!val || typeof val !== "string") return false
                    if (id === "personal") return ["firstName", "lastName", "email", "mobile", "city", "state"].includes(key)
                    if (id === "education") return ["eduPostgradDegree", "eduPostgradCollege", "eduUndergradCollege"].includes(key)
                    if (id === "registration") return ["mciCouncilNumber", "asiMembershipNo"].includes(key)
                    return false
                  })
                  .map(([key, val]) => (
                    <span key={key} className="text-xs bg-muted px-2 py-1 rounded-md">
                      {val as string}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </Card>
      </motion.div>
    )

    return (
      <motion.div
        initial={{ opacity: 0, x: 50 }}
        animate={{ opacity: 1, x: 0 }}
        className="max-w-2xl mx-auto space-y-4"
      >
        <button
          onClick={() => setPhase("upload")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Upload
        </button>

        <div className="text-center mb-2">
          <div className="inline-flex items-center gap-2 text-success text-sm mb-2">
            <CheckCircle className="h-4 w-4" /> AI extracted your details
          </div>
          <h2 className="text-2xl font-bold">Review Your Application</h2>
          <p className="text-muted-foreground text-sm">
            Click any section to edit. Fields marked * are required.
          </p>
        </div>

        {/* Membership Type */}
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                <Award className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="font-semibold">{type?.name}</p>
                <p className="text-xs text-muted-foreground">{type?.eligibility}</p>
              </div>
            </div>
            <p className="text-lg font-bold text-primary">{fee.currency}{fee.totalFee.toLocaleString()}</p>
          </CardContent>
        </Card>

        <Section id="personal" title="Personal Details" icon={Users}>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <Label className="text-xs">Salutation</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.salutation}
                onChange={(e) => updateField("salutation", e.target.value)}
              >
                {["Dr.", "Prof.", "Mr.", "Mrs.", "Ms."].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <FieldInput field="firstName" label="First Name" required />
            <FieldInput field="lastName" label="Last Name" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FieldInput field="dob" label="Date of Birth" required />
            <SelectInput field="gender" label="Gender" options={["Male", "Female", "Other"]} required />
            <FieldInput field="fatherName" label="Father's Name" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldInput field="email" label="Email" required />
            <FieldInput field="mobile" label="Mobile (10 digits)" required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldInput field="streetLine1" label="Address Line 1" required />
            <FieldInput field="streetLine2" label="Address Line 2" />
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <FieldInput field="city" label="City" required />
            <SelectInput field="state" label="State" options={INDIAN_STATES} required />
            <FieldInput field="pin" label="PIN Code" required />
            <div>
              <Label className="text-xs">Zone</Label>
              <Input value={formData.zone} disabled className="bg-muted" />
            </div>
          </div>
        </Section>

        <Section id="education" title="Education" icon={GraduationCap}>
          {type?.requiresMBBS && (
            <>
              <p className="text-xs font-medium text-muted-foreground">MBBS / Undergraduate</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldInput field="eduUndergradCollege" label="College" required />
                <FieldInput field="eduUndergradUniversity" label="University" required />
              </div>
              <FieldInput field="eduUndergradYear" label="Year" required />
            </>
          )}
          {type?.requiresPG && (
            <>
              <p className="text-xs font-medium text-muted-foreground mt-2">Postgraduate</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldInput field="eduPostgradDegree" label="Degree" required />
                <FieldInput field="eduPostgradCollege" label="College" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <FieldInput field="eduPostgradUniversity" label="University" required />
                <FieldInput field="eduPostgradYear" label="Year" required />
              </div>
            </>
          )}
          <p className="text-xs font-medium text-muted-foreground mt-2">Super Specialty (Optional)</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldInput field="eduSuperspecialtyDegree" label="Degree" />
            <FieldInput field="eduSuperspecialtyCollege" label="College" />
          </div>
        </Section>

        <Section id="registration" title="Registration & Memberships" icon={Stethoscope}>
          {formData.membershipType !== "ILM" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldInput field="mciCouncilNumber" label="MCI/State Council Number" required />
              <SelectInput field="mciCouncilState" label="Council State" options={INDIAN_STATES} required />
            </div>
          )}
          {type?.requiresASI && (
            <div className="grid gap-3 sm:grid-cols-2">
              <FieldInput field="asiMembershipNo" label="ASI Membership Number" required />
              <SelectInput field="asiState" label="ASI State" options={INDIAN_STATES} />
            </div>
          )}
          <FieldInput field="imrRegNo" label="IMR Registration Number (Optional)" />
        </Section>

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
        <Card className="bg-muted/30">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-sm">
              <span>Membership Fee</span>
              <span>{fee.currency}{fee.baseFee.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>Processing ({type?.processingFeePercent}%)</span>
              <span>{fee.currency}{fee.processingFee.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between font-bold text-lg border-t mt-2 pt-2">
              <span>Total</span>
              <span className="text-primary">{fee.currency}{fee.totalFee.toLocaleString()}</span>
            </div>
          </CardContent>
        </Card>

        <Button className="w-full h-12 text-base gap-2" onClick={handleSubmit}>
          <Send className="h-5 w-5" /> Submit Application
        </Button>
      </motion.div>
    )
  }

  // ===== SUCCESS =====
  if (phase === "success") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md mx-auto text-center py-16"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", delay: 0.2 }}
          className="h-20 w-20 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-6"
        >
          <CheckCircle className="h-10 w-10 text-success" />
        </motion.div>
        <h2 className="text-2xl font-bold mb-2">Application Submitted!</h2>
        <p className="text-muted-foreground mb-6">
          Your {selectedType?.name} application has been submitted.
          We&apos;ll send a confirmation to <strong>{formData.email}</strong>.
        </p>
        <div className="space-y-3">
          <Button variant="outline" className="w-full" onClick={() => window.location.href = "/apply/status"}>
            Track Application Status
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => window.location.href = "/"}>
            Go to Dashboard
          </Button>
        </div>
      </motion.div>
    )
  }

  return null
}
