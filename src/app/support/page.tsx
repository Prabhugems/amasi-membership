"use client"

import { useState, useRef, useEffect, Suspense } from "react"
import Link from "next/link"
import {
  Headphones, Search, Send, Loader2, CheckCircle, ArrowLeft,
  MessageSquare, Clock, User, ShieldCheck, ChevronDown, ChevronRight,
  Paperclip, AlertCircle, HelpCircle, FileText, CreditCard, UserCog,
  BookOpen, Shield, X,
} from "lucide-react"
import { AdminBackLink } from "@/components/ui/admin-back-link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { HelpButton } from "@/components/ui/help-button"
import { formatDate } from "@/lib/utils"

/* ---------- types ---------- */
interface Ticket {
  id: string
  ticket_number: string
  name: string
  email: string
  phone: string | null
  amasi_number: string | null
  category: string
  subject: string
  description: string
  status: string
  priority?: string
  created_at: string
}

interface Reply {
  id: string
  ticket_id: string
  author_name: string
  message: string
  is_admin: boolean
  created_at: string
}

/* ---------- constants ---------- */
const CATEGORIES = [
  "Application Issue",
  "Profile Update",
  "Payment Issue",
  "Certificate/Card",
  "Technical Issue",
  "Other",
]

const PRIORITIES = [
  { value: "low", label: "Low", description: "General inquiry, no urgency" },
  { value: "normal", label: "Normal", description: "Standard support request" },
  { value: "high", label: "High", description: "Blocking issue, needs prompt attention" },
]

const FAQ_ITEMS = [
  {
    question: "How long does application review take?",
    answer: "Applications are typically reviewed within 1-2 business days. You will receive an email notification once your application has been processed.",
    icon: Clock,
  },
  {
    question: "How do I download my membership card?",
    answer: "Login to the Member Portal and go to the Card section. You can download a digital copy of your membership card from there.",
    icon: CreditCard,
  },
  {
    question: "I forgot my reference number",
    answer: "Use your email or phone number to track your application status in the 'Track My Tickets' section below. You can also search for your application using the same details on the main portal.",
    icon: Search,
  },
  {
    question: "How do I update my profile?",
    answer: "Visit the Profile section of the Member Portal and verify your identity with OTP. Once verified, you can update your personal and professional details.",
    icon: UserCog,
  },
  {
    question: "What documents are required for membership?",
    answer: "You need to upload: (1) a recent passport-size Photo, (2) PG Degree Certificate, and (3) MCI/NMC Registration Certificate. All documents should be clear, legible scans or photos.",
    icon: FileText,
  },
  {
    question: "What are the membership fees?",
    answer: "Membership fees vary by category. Please refer to the membership application page for the latest fee structure. Payments can be made online via UPI, credit/debit card, or net banking.",
    icon: CreditCard,
  },
  {
    question: "How do I renew my membership?",
    answer: "Login to the Member Portal and navigate to the Renewal section. Follow the prompts to complete your renewal before the expiry date to avoid any lapse in membership benefits.",
    icon: Shield,
  },
  {
    question: "My payment was deducted but application shows pending",
    answer: "Payment reconciliation may take up to 30 minutes. If the issue persists after that, please submit a support ticket with your transaction ID and screenshot of the payment confirmation.",
    icon: AlertCircle,
  },
  {
    question: "Can I change my membership category after applying?",
    answer: "Category changes are possible before your application is approved. Please submit a support ticket with your reference number and the desired category change, and our team will assist you.",
    icon: BookOpen,
  },
  {
    question: "Who is eligible for AMASI membership?",
    answer: "AMASI membership is open to qualified anesthesiologists who hold a recognized postgraduate degree (MD/DA/DNB) in Anesthesiology and are registered with MCI/NMC or the respective State Medical Council.",
    icon: HelpCircle,
  },
]

const DESCRIPTION_MAX = 2000

function statusBadgeVariant(status: string) {
  switch (status) {
    case "open":
      return "warning" as const
    case "in_progress":
      return "secondary" as const
    case "resolved":
      return "success" as const
    case "closed":
      return "outline" as const
    default:
      return "outline" as const
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "open":
      return "Open"
    case "in_progress":
      return "In Progress"
    case "resolved":
      return "Resolved"
    case "closed":
      return "Closed"
    default:
      return status
  }
}

function timeAgo(dateStr: string) {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const minutes = Math.floor(diffMs / 60000)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return formatDate(dateStr)
}

/* ---------- FAQ Section ---------- */
function FAQSection() {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)

  const displayed = showAll ? FAQ_ITEMS : FAQ_ITEMS.slice(0, 5)

  return (
    <Card className="rounded-xl mb-10">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <HelpCircle className="h-5 w-5 text-primary" />
          Frequently Asked Questions
        </CardTitle>
        <CardDescription>
          Find quick answers before submitting a ticket
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {displayed.map((item, idx) => {
          const isOpen = openIndex === idx
          const Icon = item.icon
          return (
            <button
              key={idx}
              onClick={() => setOpenIndex(isOpen ? null : idx)}
              className="w-full text-left"
            >
              <div
                className={`rounded-lg px-4 py-3 transition-all ${
                  isOpen
                    ? "bg-primary/5 border border-primary/20"
                    : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center ${
                    isOpen ? "bg-primary/10" : "bg-muted/60"
                  }`}>
                    <Icon className={`h-4 w-4 ${isOpen ? "text-primary" : "text-muted-foreground"}`} />
                  </div>
                  <span className={`flex-1 text-sm font-medium ${isOpen ? "text-primary" : ""}`}>
                    {item.question}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200 ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
                {isOpen && (
                  <div className="mt-2 ml-11 text-sm text-muted-foreground leading-relaxed pb-1">
                    {item.answer}
                  </div>
                )}
              </div>
            </button>
          )
        })}
        {FAQ_ITEMS.length > 5 && (
          <div className="pt-2 text-center">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAll(!showAll)}
              className="text-primary"
            >
              {showAll ? "Show fewer" : `Show all ${FAQ_ITEMS.length} questions`}
              <ChevronRight className={`h-4 w-4 ml-1 transition-transform ${showAll ? "rotate-90" : ""}`} />
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

/* ---------- Status Timeline ---------- */
function StatusTimeline({ ticket, replies }: { ticket: Ticket; replies: Reply[] }) {
  const steps = [
    { status: "open", label: "Ticket Created", description: "Your ticket has been received" },
    { status: "in_progress", label: "In Progress", description: "Our team is working on it" },
    { status: "resolved", label: "Resolved", description: "Issue has been resolved" },
    { status: "closed", label: "Closed", description: "Ticket is closed" },
  ]

  const statusOrder = ["open", "in_progress", "resolved", "closed"]
  const currentIdx = statusOrder.indexOf(ticket.status)

  return (
    <div className="py-3 px-1">
      <div className="flex items-center justify-between relative">
        {/* Progress bar background */}
        <div className="absolute top-4 left-6 right-6 h-0.5 bg-muted" />
        {/* Progress bar filled */}
        <div
          className="absolute top-4 left-6 h-0.5 bg-primary transition-all duration-500"
          style={{ width: `calc(${(currentIdx / (steps.length - 1)) * 100}% - 48px)` }}
        />
        {steps.map((step, idx) => {
          const isActive = idx <= currentIdx
          const isCurrent = idx === currentIdx
          return (
            <div key={step.status} className="flex flex-col items-center z-10 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                  isCurrent
                    ? "bg-primary text-primary-foreground ring-4 ring-primary/20"
                    : isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {isActive ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <span>{idx + 1}</span>
                )}
              </div>
              <p className={`text-[10px] mt-1.5 font-medium text-center ${
                isCurrent ? "text-primary" : isActive ? "text-foreground" : "text-muted-foreground"
              }`}>
                {step.label}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- Chat Bubble ---------- */
function ChatBubble({ reply }: { reply: Reply }) {
  const isAdmin = reply.is_admin
  return (
    <div className={`flex ${isAdmin ? "justify-start" : "justify-end"} mb-3`}>
      <div className={`flex gap-2 max-w-[85%] ${isAdmin ? "flex-row" : "flex-row-reverse"}`}>
        {/* Avatar */}
        <div
          className={`shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 ${
            isAdmin
              ? "bg-blue-100 text-blue-700"
              : "bg-primary/10 text-primary"
          }`}
        >
          {isAdmin ? (
            <ShieldCheck className="h-3.5 w-3.5" />
          ) : (
            <User className="h-3.5 w-3.5" />
          )}
        </div>
        {/* Bubble */}
        <div>
          <div
            className={`px-3.5 py-2.5 text-sm leading-relaxed ${
              isAdmin
                ? "bg-white border border-gray-200 rounded-2xl rounded-tl-sm shadow-sm"
                : "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm"
            }`}
          >
            <p className="whitespace-pre-wrap">{reply.message}</p>
          </div>
          <div className={`flex items-center gap-1.5 mt-1 px-1 ${isAdmin ? "" : "justify-end"}`}>
            <span className="text-[10px] text-muted-foreground font-medium">
              {reply.author_name}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {timeAgo(reply.created_at)}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- main component ---------- */
function SupportContent() {
  // form state
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [amasiNumber, setAmasiNumber] = useState("")
  const [category, setCategory] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState("normal")
  const [attachment, setAttachment] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submittedTicket, setSubmittedTicket] = useState<string | null>(null)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)

  // track state
  const [searchQuery, setSearchQuery] = useState("")
  const [searching, setSearching] = useState(false)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [searchDone, setSearchDone] = useState(false)

  // dialog state
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [replies, setReplies] = useState<Reply[]>([])
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [replyText, setReplyText] = useState("")
  const [sendingReply, setSendingReply] = useState(false)
  const [showTyping, setShowTyping] = useState(false)

  const repliesEndRef = useRef<HTMLDivElement>(null)
  const repliesContainerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to latest reply
  useEffect(() => {
    if (repliesEndRef.current) {
      repliesEndRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [replies, showTyping])

  /* --- handle file attachment --- */
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    // Max 5MB
    if (file.size > 5 * 1024 * 1024) {
      setFormErrors((prev) => ({ ...prev, attachment: "File must be under 5MB" }))
      return
    }
    const allowed = ["image/png", "image/jpeg", "image/webp", "application/pdf"]
    if (!allowed.includes(file.type)) {
      setFormErrors((prev) => ({ ...prev, attachment: "Only PNG, JPG, WebP, or PDF files allowed" }))
      return
    }
    setFormErrors((prev) => {
      const next = { ...prev }
      delete next.attachment
      return next
    })
    setAttachment(file)
  }

  /* --- submit ticket --- */
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
      return
    }
    setFormErrors({})
    setSubmitting(true)

    try {
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
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to submit ticket")

      setSubmittedTicket(data.ticket_number || data.ticket?.ticket_number)
      // reset form
      setName("")
      setEmail("")
      setPhone("")
      setAmasiNumber("")
      setCategory("")
      setSubject("")
      setDescription("")
      setPriority("normal")
      setAttachment(null)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Something went wrong"
      setFormErrors({ _form: message })
    } finally {
      setSubmitting(false)
    }
  }

  /* --- search tickets --- */
  async function handleSearch() {
    if (!searchQuery.trim()) return
    setSearching(true)
    setSearchDone(false)

    try {
      const isPhone = /^\d{10,}$/.test(searchQuery.trim().replace(/\s/g, ""))
      const param = isPhone
        ? `phone=${encodeURIComponent(searchQuery.trim())}`
        : `email=${encodeURIComponent(searchQuery.trim())}`

      const res = await fetch(`/api/tickets?${param}`)
      const data = await res.json()
      setTickets(Array.isArray(data) ? data : [])
    } catch {
      setTickets([])
    } finally {
      setSearching(false)
      setSearchDone(true)
    }
  }

  /* --- open ticket detail --- */
  async function openTicket(ticket: Ticket) {
    setSelectedTicket(ticket)
    setReplies([])
    setReplyText("")
    setLoadingReplies(true)
    setShowTyping(false)

    try {
      const res = await fetch(`/api/tickets/${ticket.id}`)
      const data = await res.json()
      setReplies(data.replies || [])
    } catch {
      setReplies([])
    } finally {
      setLoadingReplies(false)
    }
  }

  /* --- send reply --- */
  async function handleReply() {
    if (!replyText.trim() || !selectedTicket) return
    setSendingReply(true)

    try {
      const res = await fetch(`/api/tickets/${selectedTicket.id}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: replyText.trim(),
          author_name: selectedTicket.name,
          is_admin: false,
        }),
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.error || "Failed to send reply")

      setReplies((prev) => [...prev, data.reply || data])
      setReplyText("")

      // Show fake typing indicator for UX polish
      setShowTyping(true)
      setTimeout(() => setShowTyping(false), 3000)
    } catch {
      // silently fail -- user can retry
    } finally {
      setSendingReply(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary transition-colors mb-6"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AMASI
        </Link>

        {/* Header */}
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Headphones className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Support Center</h1>
          <p className="text-muted-foreground mt-2">
            Find answers, submit tickets, or track existing requests
          </p>
        </div>

        {/* ======== FAQ Section ======== */}
        <FAQSection />

        {/* ======== Submit Ticket Form ======== */}
        {submittedTicket ? (
          <Card className="rounded-xl border-green-200 bg-green-50/50 mb-10">
            <CardContent className="p-8 text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-8 w-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-green-800">Ticket Submitted!</h2>
              <p className="text-sm text-green-700">
                Your ticket number is:
              </p>
              <div className="inline-block bg-white border-2 border-green-300 rounded-xl px-6 py-3">
                <span className="text-2xl font-mono font-bold text-green-700 tracking-wider">
                  {submittedTicket}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Save this number for reference. We will get back to you via email.
              </p>
              <Button
                variant="outline"
                onClick={() => setSubmittedTicket(null)}
                className="mt-2"
              >
                Submit Another Ticket
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-xl mb-10">
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
              <form onSubmit={handleSubmit} className="space-y-4">
                {formErrors._form && (
                  <div className="bg-destructive/10 text-destructive text-sm rounded-lg px-4 py-3 flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {formErrors._form}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name */}
                  <div>
                    <Label className="text-xs">
                      Name <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your full name"
                      className={formErrors.name ? "border-destructive" : ""}
                    />
                    {formErrors.name && (
                      <p className="text-xs text-destructive mt-0.5">{formErrors.name}</p>
                    )}
                  </div>

                  {/* Email */}
                  <div>
                    <Label className="text-xs">
                      Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your@email.com"
                      className={formErrors.email ? "border-destructive" : ""}
                    />
                    {formErrors.email && (
                      <p className="text-xs text-destructive mt-0.5">{formErrors.email}</p>
                    )}
                  </div>

                  {/* Phone */}
                  <div>
                    <Label className="text-xs">Phone</Label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>

                  {/* AMASI Number */}
                  <div>
                    <Label className="text-xs">AMASI Number</Label>
                    <Input
                      value={amasiNumber}
                      onChange={(e) => setAmasiNumber(e.target.value)}
                      placeholder="Optional"
                    />
                  </div>
                </div>

                {/* Category & Priority in one row */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Category */}
                  <div>
                    <Label className="text-xs">
                      Category <span className="text-destructive">*</span>
                    </Label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className={`flex h-10 w-full rounded-md border bg-background px-3 py-2 text-sm ${
                        formErrors.category ? "border-destructive" : "border-input"
                      }`}
                    >
                      <option value="">Select a category...</option>
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                    {formErrors.category && (
                      <p className="text-xs text-destructive mt-0.5">{formErrors.category}</p>
                    )}
                  </div>

                  {/* Priority */}
                  <div>
                    <Label className="text-xs">Priority</Label>
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p.value} value={p.value}>{p.label} - {p.description}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Subject */}
                <div>
                  <Label className="text-xs">
                    Subject <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Brief summary of your issue"
                    className={formErrors.subject ? "border-destructive" : ""}
                  />
                  {formErrors.subject && (
                    <p className="text-xs text-destructive mt-0.5">{formErrors.subject}</p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">
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
                    value={description}
                    onChange={(e) => {
                      if (e.target.value.length <= DESCRIPTION_MAX) {
                        setDescription(e.target.value)
                      }
                    }}
                    placeholder="Please describe your issue in detail (min 20 characters)"
                    rows={5}
                    className={formErrors.description ? "border-destructive" : ""}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Describe your issue clearly for faster resolution. Include relevant details like reference numbers or error messages.
                  </p>
                  {formErrors.description && (
                    <p className="text-xs text-destructive mt-0.5">{formErrors.description}</p>
                  )}
                </div>

                {/* File Attachment — Coming soon */}
                <div>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Attachment (optional)</Label>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Coming soon</Badge>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-1.5 gap-1.5 opacity-50 cursor-not-allowed"
                    disabled
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Attach Screenshot or Document
                  </Button>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    File attachments will be supported in a future update.
                  </p>
                </div>

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Submitting...
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
        )}

        {/* ======== Track Tickets ======== */}
        <div className="space-y-4">
          <div className="text-center">
            <h2 className="text-xl font-semibold flex items-center justify-center gap-2">
              <Search className="h-5 w-5 text-primary" />
              Track My Tickets
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Enter your email or phone number to find your tickets
            </p>
          </div>

          <Card className="rounded-xl">
            <CardContent className="p-4">
              <div className="flex gap-2">
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Email or phone number"
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1"
                />
                <Button onClick={handleSearch} disabled={searching || !searchQuery.trim()}>
                  {searching ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Search className="h-4 w-4 mr-1.5" />
                      Search
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Ticket list */}
          {searchDone && tickets.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              No tickets found. Check your email or phone number and try again.
            </div>
          )}

          {tickets.length > 0 && (
            <div className="space-y-3">
              {tickets.map((ticket) => (
                <Card
                  key={ticket.id}
                  className="rounded-xl cursor-pointer hover:border-primary/40 hover:shadow-md transition-all"
                  onClick={() => openTicket(ticket)}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-muted-foreground">
                            {ticket.ticket_number}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {ticket.category}
                          </Badge>
                          <Badge variant={statusBadgeVariant(ticket.status)} className="text-[10px]">
                            {statusLabel(ticket.status)}
                          </Badge>
                        </div>
                        <h3 className="font-medium mt-1 truncate">{ticket.subject}</h3>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(ticket.created_at)}
                        </div>
                      </div>
                      <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* ======== Ticket Detail Dialog ======== */}
        <Dialog open={!!selectedTicket} onOpenChange={(open) => !open && setSelectedTicket(null)}>
          <DialogContent className="max-w-lg max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden" aria-describedby={undefined}>
            {/* Dialog Header */}
            <div className="px-5 pt-5 pb-3 border-b bg-muted/30">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base pr-6">
                  <MessageSquare className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate">{selectedTicket?.subject}</span>
                </DialogTitle>
                {selectedTicket && (
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    <span className="text-xs font-mono text-muted-foreground">
                      {selectedTicket.ticket_number}
                    </span>
                    <Badge variant="outline" className="text-[10px]">
                      {selectedTicket.category}
                    </Badge>
                    <Badge variant={statusBadgeVariant(selectedTicket.status)} className="text-[10px]">
                      {statusLabel(selectedTicket.status)}
                    </Badge>
                  </div>
                )}
              </DialogHeader>

              {/* Status timeline */}
              {selectedTicket && (
                <StatusTimeline ticket={selectedTicket} replies={replies} />
              )}
            </div>

            {/* Chat area */}
            <div
              ref={repliesContainerRef}
              className="flex-1 overflow-y-auto min-h-0 px-4 py-4"
              style={{ maxHeight: "50vh" }}
            >
              {/* Original description as first message */}
              {selectedTicket && (
                <div className="flex justify-end mb-3">
                  <div className="flex gap-2 max-w-[85%] flex-row-reverse">
                    <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-[10px] font-bold mt-1 bg-primary/10 text-primary">
                      <User className="h-3.5 w-3.5" />
                    </div>
                    <div>
                      <div className="px-3.5 py-2.5 text-sm leading-relaxed bg-primary text-primary-foreground rounded-2xl rounded-tr-sm shadow-sm">
                        <p className="whitespace-pre-wrap">{selectedTicket.description}</p>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1 px-1 justify-end">
                        <span className="text-[10px] text-muted-foreground font-medium">
                          {selectedTicket.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {timeAgo(selectedTicket.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Loading */}
              {loadingReplies && (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}

              {/* Replies */}
              {!loadingReplies && replies.length === 0 && (
                <div className="text-center py-4">
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded-full px-3 py-1.5 inline-block">
                    Waiting for a response from our team
                  </p>
                </div>
              )}

              {!loadingReplies && replies.map((reply) => (
                <ChatBubble key={reply.id} reply={reply} />
              ))}

              {/* Typing indicator */}
              {showTyping && (
                <div className="flex justify-start mb-3">
                  <div className="flex gap-2 items-end">
                    <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center bg-blue-100 text-blue-700">
                      <ShieldCheck className="h-3.5 w-3.5" />
                    </div>
                    <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
                      <div className="flex gap-1">
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={repliesEndRef} />
            </div>

            {/* Reply form */}
            {selectedTicket && selectedTicket.status !== "closed" && (
              <div className="px-4 py-3 border-t bg-muted/20">
                <div className="flex gap-2 items-end">
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Type your message..."
                    rows={1}
                    className="flex-1 resize-none min-h-[40px] max-h-[120px] bg-white"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        handleReply()
                      }
                    }}
                  />
                  <Button
                    onClick={handleReply}
                    disabled={sendingReply || !replyText.trim()}
                    size="sm"
                    className="h-10 w-10 p-0 rounded-full shrink-0"
                  >
                    {sendingReply ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground mt-1.5">
                  Press Enter to send, Shift+Enter for new line
                </p>
              </div>
            )}

            {selectedTicket && selectedTicket.status === "closed" && (
              <div className="px-4 py-3 border-t bg-muted/30 text-center">
                <p className="text-xs text-muted-foreground">
                  This ticket has been closed. If you need further help, please submit a new ticket.
                </p>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <HelpButton />
    </div>
  )
}

export default function SupportPage() {
  return (
    <>
      <AdminBackLink />
      <Suspense
        fallback={
          <div className="min-h-screen bg-background flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        <SupportContent />
      </Suspense>
    </>
  )
}
