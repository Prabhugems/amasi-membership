"use client"

import { useState, useRef, useCallback, useMemo } from "react"
import Link from "next/link"
import {
  Send, Loader2, CheckCircle, Paperclip, AlertCircle, X, Copy, Check,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  CATEGORIES, PRIORITIES, DESCRIPTION_MAX, MAX_ATTACHMENTS, MAX_FILE_SIZE,
  ALLOWED_FILE_TYPES,
} from "./types"
import type { TicketAttachment } from "./types"
import { formatFileSize, uploadTicketFile } from "./helpers"

export function TicketCreationForm() {
  // form state
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [amasiNumber, setAmasiNumber] = useState("")
  const [category, setCategory] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("normal")
  const [attachments, setAttachments] = useState<File[]>([])
  const [uploadingFiles, setUploadingFiles] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submittedTicket, setSubmittedTicket] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Image previews memo
  const imagePreviews = useMemo(() => {
    return attachments.map((file) => {
      if (file.type.startsWith("image/")) {
        return URL.createObjectURL(file)
      }
      return null
    })
  }, [attachments])

  // Inline validation on blur
  const validateField = useCallback((field: string, value: string) => {
    setTouchedFields((prev) => ({ ...prev, [field]: true }))
    setFormErrors((prev) => {
      const next = { ...prev }
      switch (field) {
        case "name":
          if (!value.trim()) next.name = "Name is required"
          else delete next.name
          break
        case "email":
          if (!value.trim()) next.email = "Email is required"
          else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) next.email = "Enter a valid email address"
          else delete next.email
          break
        case "category":
          if (!value) next.category = "Please select a category"
          else delete next.category
          break
        case "subject":
          if (!value.trim()) next.subject = "Subject is required"
          else delete next.subject
          break
        case "description":
          if (!value.trim()) next.description = "Description is required"
          else if (value.trim().length < 20) next.description = "Description must be at least 20 characters"
          else delete next.description
          break
      }
      return next
    })
  }, [])

  function handleFileAdd(files: FileList | File[]) {
    const newFiles: File[] = []
    const fileArr = Array.from(files)
    for (const file of fileArr) {
      if (attachments.length + newFiles.length >= MAX_ATTACHMENTS) {
        setFormErrors((prev) => ({ ...prev, attachment: `Maximum ${MAX_ATTACHMENTS} files allowed` }))
        break
      }
      if (file.size > MAX_FILE_SIZE) {
        setFormErrors((prev) => ({ ...prev, attachment: `${file.name} exceeds 10 MB limit` }))
        continue
      }
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        setFormErrors((prev) => ({ ...prev, attachment: "Only PNG, JPG, WebP, or PDF files allowed" }))
        continue
      }
      newFiles.push(file)
    }
    if (newFiles.length > 0) {
      setFormErrors((prev) => {
        const next = { ...prev }
        delete next.attachment
        return next
      })
      setAttachments((prev) => [...prev, ...newFiles].slice(0, MAX_ATTACHMENTS))
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files) return
    handleFileAdd(files)
    e.target.value = ""
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files) {
      handleFileAdd(e.dataTransfer.files)
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault()
    setIsDragOver(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errors: Record<string, string> = {}
    if (!name.trim()) errors.name = "Name is required"
    if (!email.trim()) errors.email = "Email is required"
    if (!category) errors.category = "Please select a category"
    if (!subject.trim()) errors.subject = "Subject is required"
    if (!description.trim()) errors.description = "Description is required"
    else if (description.trim().length < 20) errors.description = "Description must be at least 20 characters"

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      setTouchedFields({ name: true, email: true, category: true, subject: true, description: true })
      return
    }
    setFormErrors({})
    setSubmitting(true)

    try {
      let uploadedAttachments: TicketAttachment[] = []
      if (attachments.length > 0) {
        setUploadingFiles(true)
        const tempId = `new_${Date.now()}`
        const uploads = await Promise.all(
          attachments.map((file) =>
            uploadTicketFile(file, `tickets/${tempId}/${file.name}`)
          )
        )
        uploadedAttachments = uploads.filter((a): a is TicketAttachment => a !== null)
        setUploadingFiles(false)
      }

      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          phone: phone.trim() || null,
          amasi_number: amasiNumber.trim() || null,
          category,
          subject: subject.trim(),
          description: description.trim(),
          priority,
          attachments: uploadedAttachments,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to submit ticket")

      setSubmittedTicket(data.ticket_number || data.ticket?.ticket_number)
      setName("")
      setEmail("")
      setPhone("")
      setAmasiNumber("")
      setCategory("")
      setSubject("")
      setDescription("")
      setPriority("normal")
      setAttachments([])
      setTouchedFields({})
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong"
      setFormErrors({ _form: message })
      setUploadingFiles(false)
    } finally {
      setSubmitting(false)
    }
  }

  async function copyTicketNumber() {
    if (!submittedTicket) return
    try {
      await navigator.clipboard.writeText(submittedTicket)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback -- select the text
    }
  }

  // Success state
  if (submittedTicket) {
    return (
      <Card className="rounded-xl border-green-200 bg-green-50/50 mb-10">
        <CardContent className="p-8 text-center space-y-4">
          <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle className="h-8 w-8 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-green-800">Ticket Submitted!</h2>
          <p className="text-sm text-green-700">
            Your ticket number is:
          </p>
          <button
            onClick={copyTicketNumber}
            className="inline-flex items-center gap-2 bg-white border-2 border-green-300 rounded-xl px-6 py-3 hover:border-green-400 transition-colors cursor-pointer group"
            title="Click to copy ticket number"
          >
            <span className="text-2xl font-mono font-bold text-green-700 tracking-wider">
              {submittedTicket}
            </span>
            {copied ? (
              <Check className="h-4 w-4 text-green-600" />
            ) : (
              <Copy className="h-4 w-4 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </button>
          {copied && (
            <p className="text-xs text-green-600 font-medium">Copied to clipboard!</p>
          )}
          <div className="space-y-2">
            <Link
              href={`/support/${submittedTicket}`}
              className="text-sm text-primary hover:underline font-medium block"
            >
              View ticket details
            </Link>
            <p className="text-xs text-muted-foreground">
              Check your email for updates. We will respond as soon as possible.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setSubmittedTicket(null)}
            className="mt-2"
          >
            Submit Another Ticket
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="rounded-xl mb-10" id="ticket-form">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Send className="h-5 w-5 text-primary" />
          Submit a Ticket
        </CardTitle>
        <CardDescription>
          Could not find your answer above? Fill in the details below and we will respond as soon as possible.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {formErrors._form && (
            <div
              className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3 flex items-center gap-2"
              role="alert"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {formErrors._form}
            </div>
          )}

          {/* Contact Info: Name, Email, Phone, AMASI Number */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Name */}
            <div>
              <Label htmlFor="ticket-name" className="text-xs">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ticket-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => validateField("name", name)}
                placeholder="Your full name"
                className={formErrors.name && touchedFields.name ? "border-destructive" : ""}
                aria-describedby={formErrors.name && touchedFields.name ? "ticket-name-error" : undefined}
                aria-invalid={!!(formErrors.name && touchedFields.name)}
              />
              {formErrors.name && touchedFields.name && (
                <p id="ticket-name-error" className="text-xs text-destructive mt-0.5" role="alert">
                  {formErrors.name}
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <Label htmlFor="ticket-email" className="text-xs">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ticket-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => validateField("email", email)}
                placeholder="your@email.com"
                className={formErrors.email && touchedFields.email ? "border-destructive" : ""}
                aria-describedby={formErrors.email && touchedFields.email ? "ticket-email-error" : undefined}
                aria-invalid={!!(formErrors.email && touchedFields.email)}
              />
              {formErrors.email && touchedFields.email && (
                <p id="ticket-email-error" className="text-xs text-destructive mt-0.5" role="alert">
                  {formErrors.email}
                </p>
              )}
            </div>

            {/* Phone */}
            <div>
              <Label htmlFor="ticket-phone" className="text-xs">Phone</Label>
              <Input
                id="ticket-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Optional"
              />
            </div>

            {/* AMASI Number */}
            <div>
              <Label htmlFor="ticket-amasi" className="text-xs">AMASI Number</Label>
              <Input
                id="ticket-amasi"
                value={amasiNumber}
                onChange={(e) => setAmasiNumber(e.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>

          {/* Category */}
          <div>
            <Label htmlFor="ticket-category" className="text-xs">
              Category <span className="text-destructive">*</span>
            </Label>
            <select
              id="ticket-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value)
                if (touchedFields.category) validateField("category", e.target.value)
              }}
              onBlur={() => validateField("category", category)}
              className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${
                formErrors.category && touchedFields.category ? "border-destructive" : "border-input"
              }`}
              aria-describedby={formErrors.category && touchedFields.category ? "ticket-category-error" : undefined}
              aria-invalid={!!(formErrors.category && touchedFields.category)}
            >
              <option value="">Select a category...</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.value} — {c.description}
                </option>
              ))}
            </select>
            {formErrors.category && touchedFields.category && (
              <p id="ticket-category-error" className="text-xs text-destructive mt-0.5" role="alert">
                {formErrors.category}
              </p>
            )}
          </div>

          {/* Subject */}
          <div>
            <Label htmlFor="ticket-subject" className="text-xs">
              Subject <span className="text-destructive">*</span>
            </Label>
            <Input
              id="ticket-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onBlur={() => validateField("subject", subject)}
              placeholder="Brief summary of your issue"
              className={formErrors.subject && touchedFields.subject ? "border-destructive" : ""}
              aria-describedby={formErrors.subject && touchedFields.subject ? "ticket-subject-error" : undefined}
              aria-invalid={!!(formErrors.subject && touchedFields.subject)}
            />
            {formErrors.subject && touchedFields.subject && (
              <p id="ticket-subject-error" className="text-xs text-destructive mt-0.5" role="alert">
                {formErrors.subject}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor="ticket-description" className="text-xs">
                Description <span className="text-destructive">*</span>
              </Label>
              <span className={`text-[10px] tabular-nums ${
                description.length > DESCRIPTION_MAX
                  ? "text-destructive font-medium"
                  : description.length > DESCRIPTION_MAX * 0.9
                    ? "text-amber-600"
                    : "text-muted-foreground"
              }`}>
                {description.length}/{DESCRIPTION_MAX}
              </span>
            </div>
            <Textarea
              id="ticket-description"
              value={description}
              onChange={(e) => {
                if (e.target.value.length <= DESCRIPTION_MAX) {
                  setDescription(e.target.value)
                }
              }}
              onBlur={() => validateField("description", description)}
              placeholder="Please describe your issue in detail (min 20 characters)"
              rows={5}
              className={formErrors.description && touchedFields.description ? "border-destructive" : ""}
              aria-describedby={
                [
                  formErrors.description && touchedFields.description ? "ticket-description-error" : "",
                  "ticket-description-hint",
                ].filter(Boolean).join(" ") || undefined
              }
              aria-invalid={!!(formErrors.description && touchedFields.description)}
            />
            <p id="ticket-description-hint" className="text-[10px] text-muted-foreground mt-1">
              Describe your issue clearly for faster resolution. Include relevant details like reference numbers or error messages.
            </p>
            {formErrors.description && touchedFields.description && (
              <p id="ticket-description-error" className="text-xs text-destructive mt-0.5" role="alert">
                {formErrors.description}
              </p>
            )}
          </div>

          {/* Priority - small optional field */}
          <div className="max-w-xs">
            <Label htmlFor="ticket-priority" className="text-xs text-muted-foreground">
              Priority (optional)
            </Label>
            <select
              id="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs"
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>{p.label} - {p.description}</option>
              ))}
            </select>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Leave as Normal unless your issue is urgent.
            </p>
          </div>

          {/* File Attachment */}
          <div>
            <Label htmlFor="ticket-files" className="text-xs">Attachments (optional)</Label>
            {/* Existing file chips with previews */}
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-1.5 mb-2">
                {attachments.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 bg-muted/60 border rounded-lg px-3 py-1.5 text-xs"
                  >
                    {imagePreviews[i] && (
                      <img
                        src={imagePreviews[i]!}
                        alt={file.name}
                        className="h-8 w-8 object-cover rounded"
                      />
                    )}
                    <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate max-w-[160px]">{file.name}</span>
                    <span className="text-muted-foreground">({formatFileSize(file.size)})</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      className="ml-1 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={`Remove ${file.name}`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Drag-and-drop zone */}
            {attachments.length < MAX_ATTACHMENTS && (
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={`mt-1.5 border-2 border-dashed rounded-lg px-4 py-6 text-center cursor-pointer transition-colors ${
                  isDragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"
                }`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault()
                    fileInputRef.current?.click()
                  }
                }}
                aria-label="Upload files by dropping or clicking"
              >
                <Paperclip className="h-5 w-5 mx-auto text-muted-foreground mb-1.5" />
                <p className="text-sm text-muted-foreground">
                  Drop files here or click to upload
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  PNG, JPG, WebP, or PDF. Max 10 MB per file, up to {MAX_ATTACHMENTS} files.
                </p>
              </div>
            )}
            <input
              ref={fileInputRef}
              id="ticket-files"
              type="file"
              accept="image/png,image/jpeg,image/webp,application/pdf"
              className="hidden"
              onChange={handleFileChange}
              multiple
            />
            {formErrors.attachment && (
              <p className="text-xs text-destructive mt-0.5" role="alert">{formErrors.attachment}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={submitting || uploadingFiles}
            className="w-full"
          >
            {submitting || uploadingFiles ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {uploadingFiles ? "Uploading files..." : "Submitting..."}
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                Submit Ticket
              </>
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
