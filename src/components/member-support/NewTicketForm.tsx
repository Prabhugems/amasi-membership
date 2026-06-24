"use client"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Upload, X, FileText, Send, Loader2, CheckCircle2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { TICKET_CATEGORIES, PRIORITIES, type Priority } from "./support-constants"
import { createTicket } from "./support-api"

export interface MemberCtx {
  name?: string
  first_name?: string
  email: string
  phone?: string
  mobile?: string
  amasi_number?: string | number
  membership_no?: string
}

export default function NewTicketForm({
  member, onBack, onCreated,
}: { member: MemberCtx; onBack: () => void; onCreated: () => void }) {
  const [category, setCategory] = useState<string>("Other")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [priority, setPriority] = useState<Priority>("normal")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file || !file.type.startsWith("image/")) { setPreview(null); return }
    const url = URL.createObjectURL(file); setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && (f.type.startsWith("image/") || f.type === "application/pdf")) setFile(f)
  }

  const submit = async () => {
    if (!subject.trim() || !description.trim()) return
    setSubmitting(true)
    try {
      const res = await createTicket({
        name: member.name || member.first_name || "Member",
        email: member.email,
        phone: member.phone || member.mobile || "",
        amasi_number: String(member.amasi_number || member.membership_no || ""),
        category,
        subject: subject.trim(),
        description: description.trim() + (file ? `\n\n📎 Attachment: ${file.name}` : ""),
        priority,
      })
      if (res.ticket_number || res.id) {
        setDone(res.ticket_number || "Submitted")
        setTimeout(onCreated, 2500)
      } else {
        toast.error(res.error || "Couldn't submit your ticket. Please try again.")
      }
    } catch {
      toast.error("Couldn't submit your ticket. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-md border border-border bg-card p-10 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-md border border-border bg-muted">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
          </div>
          <p className="text-sm font-medium">Ticket submitted</p>
          <p className="mt-1 text-sm text-muted-foreground">Reference <span className="font-medium text-foreground">{done}</span>. We&apos;ll get back to you by email and here.</p>
        </div>
      </div>
    )
  }

  const seg = (active: boolean) =>
    `px-3 py-2 rounded-md text-sm font-medium transition-colors border ${
      active ? "bg-background border-border text-foreground shadow-sm" : "border-transparent text-muted-foreground hover:text-foreground"
    }`

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Help &amp; support</p>
          <h2 className="text-2xl font-bold tracking-tight">New ticket</h2>
        </div>
        <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
      </div>

      {/* Category */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Category</label>
        <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
          {TICKET_CATEGORIES.map((c) => (
            <button key={c} onClick={() => setCategory(c)} className={seg(category === c)}>{c}</button>
          ))}
        </div>
      </div>

      {/* Subject */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Subject <span className="text-destructive">*</span></label>
          <span className="text-xs tabular-nums text-muted-foreground">{subject.length}/120</span>
        </div>
        <Input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 120))} placeholder="Brief description of your issue" />
      </div>

      {/* Description */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Description <span className="text-destructive">*</span></label>
          <span className="text-xs tabular-nums text-muted-foreground">{description.length}/2000</span>
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
          placeholder="Include relevant details — dates, amounts, or error messages."
          rows={6}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm min-h-[140px] resize-y focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring placeholder:text-muted-foreground/60"
        />
      </div>

      {/* Attachment (filename only — preserved quirk) */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Attachment <span className="font-normal text-xs text-muted-foreground">(optional)</span></label>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileInput.current?.click()}
          className={`cursor-pointer rounded-md border border-dashed p-6 text-center transition-colors ${dragOver ? "border-primary bg-accent" : "border-border hover:bg-accent"}`}
        >
          <input ref={fileInput} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          {file ? (
            <div className="flex items-center gap-4">
              {preview ? (
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border">
                  <img src={preview} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted"><FileText className="h-5 w-5 text-muted-foreground" /></div>
              )}
              <div className="min-w-0 flex-1 text-left">
                <p className="truncate text-sm font-medium">{file.name}</p>
                <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</p>
              </div>
              <button onClick={(e) => { e.stopPropagation(); setFile(null) }} aria-label="Remove attachment" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md border border-border bg-muted"><Upload className="h-5 w-5 text-muted-foreground" /></div>
              <p className="text-sm text-muted-foreground">Drop a file or <span className="text-primary">browse</span></p>
              <p className="text-xs text-muted-foreground/70">JPG, PNG, PDF up to 5 MB</p>
            </div>
          )}
        </div>
      </div>

      {/* Priority */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Priority</label>
        <div className="flex gap-1 rounded-md bg-muted p-1">
          {PRIORITIES.map((p) => (
            <button key={p.value} onClick={() => setPriority(p.value)} className={`flex-1 ${seg(priority === p.value)}`}>{p.label}</button>
          ))}
        </div>
      </div>

      <Button onClick={submit} disabled={submitting || !subject.trim() || !description.trim()} className="w-full gap-2">
        {submitting ? <><Loader2 className="h-4 w-4 animate-spin" /> Submitting…</> : <><Send className="h-4 w-4" /> Submit ticket</>}
      </Button>
    </div>
  )
}
