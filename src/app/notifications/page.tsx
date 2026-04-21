"use client"

import { Suspense, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Bell,
  Send,
  History,
  Loader2,
  Mail,
  MessageSquare,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Settings,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { formatDate } from "@/lib/utils"
import { toast } from "sonner"
import { INDIAN_STATES } from "@/lib/membership-types"

const ZONES = ["North Zone", "South Zone", "East Zone", "West Zone", "Central Zone", "International"]
const MEMBERSHIP_TYPES = ["LM", "ALM", "ACM", "ILM"]

interface WhatsAppTemplate {
  id: string
  name: string
  template_id: string
  description: string | null
  variables: string[]
  is_active: boolean
  created_at: string
}

// --- WhatsApp Template Management Dialog ---

function WhatsAppTemplatesDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<WhatsAppTemplate & { variablesStr: string }>>({})
  const [newTemplate, setNewTemplate] = useState({
    name: "",
    template_id: "",
    description: "",
    variablesStr: "",
  })

  const { data: templates = [], isLoading } = useQuery<WhatsAppTemplate[]>({
    queryKey: ["whatsapp-templates"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp-templates")
      if (!res.ok) throw new Error("Failed to fetch templates")
      return res.json()
    },
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: async (tpl: typeof newTemplate) => {
      const variables = tpl.variablesStr
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean)
      const res = await fetch("/api/whatsapp-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tpl.name,
          template_id: tpl.template_id,
          description: tpl.description || null,
          variables,
        }),
      })
      if (!res.ok) throw new Error("Failed to create template")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Template created")
      setNewTemplate({ name: "", template_id: "", description: "", variablesStr: "" })
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] })
    },
    onError: () => toast.error("Failed to create template"),
  })

  const updateMutation = useMutation({
    mutationFn: async (tpl: Partial<WhatsAppTemplate & { variablesStr: string }> & { id: string }) => {
      const payload: Record<string, unknown> = { id: tpl.id }
      if (tpl.name !== undefined) payload.name = tpl.name
      if (tpl.template_id !== undefined) payload.template_id = tpl.template_id
      if (tpl.description !== undefined) payload.description = tpl.description
      if (tpl.variablesStr !== undefined) {
        payload.variables = tpl.variablesStr
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean)
      }
      if (tpl.is_active !== undefined) payload.is_active = tpl.is_active
      const res = await fetch("/api/whatsapp-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error("Failed to update template")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Template updated")
      setEditingId(null)
      setEditForm({})
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] })
    },
    onError: () => toast.error("Failed to update template"),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/whatsapp-templates?id=${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete template")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Template deleted")
      queryClient.invalidateQueries({ queryKey: ["whatsapp-templates"] })
    },
    onError: () => toast.error("Failed to delete template"),
  })

  const toggleActive = (tpl: WhatsAppTemplate) => {
    updateMutation.mutate({ id: tpl.id, is_active: !tpl.is_active })
  }

  const startEdit = (tpl: WhatsAppTemplate) => {
    setEditingId(tpl.id)
    setEditForm({
      name: tpl.name,
      template_id: tpl.template_id,
      description: tpl.description || "",
      variablesStr: (tpl.variables || []).join(", "),
    })
  }

  const saveEdit = () => {
    if (!editingId) return
    updateMutation.mutate({
      id: editingId,
      name: editForm.name,
      template_id: editForm.template_id,
      description: editForm.description,
      variablesStr: editForm.variablesStr,
    })
  }

  const handleCreate = () => {
    if (!newTemplate.name || !newTemplate.template_id) {
      toast.error("Name and Template ID are required")
      return
    }
    createMutation.mutate(newTemplate)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0 hover:bg-gray-100 dark:hover:bg-slate-800"
          title="Manage WhatsApp Templates"
        >
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <MessageSquare className="h-4 w-4 text-green-600" />
            WhatsApp Templates
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Manage WhatsApp notification templates. Templates must also be approved in your Gallabox/WhatsApp Business account.
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {/* Templates table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800/60 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Template ID</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Variables</th>
                    <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Active</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((tpl) => (
                    <tr key={tpl.id} className="border-b last:border-b-0 hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                      {editingId === tpl.id ? (
                        <>
                          <td className="px-3 py-2">
                            <input
                              value={editForm.name || ""}
                              onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                              className="w-full rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Template name"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={editForm.template_id || ""}
                              onChange={(e) => setEditForm({ ...editForm, template_id: e.target.value })}
                              className="w-full rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                              placeholder="template_id"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={editForm.variablesStr || ""}
                              onChange={(e) => setEditForm({ ...editForm, variablesStr: e.target.value })}
                              className="w-full rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                              placeholder="Name, Var2, Var3"
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <span className="text-muted-foreground/50">--</span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-500/15"
                                onClick={saveEdit}
                                disabled={updateMutation.isPending}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => { setEditingId(null); setEditForm({}) }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2">
                            <span className="font-medium">{tpl.name}</span>
                            {tpl.description && (
                              <span className="block text-[10px] text-muted-foreground mt-0.5">{tpl.description}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-[10px]">{tpl.template_id}</td>
                          <td className="px-3 py-2">
                            <div className="flex flex-wrap gap-1">
                              {(tpl.variables || []).map((v) => (
                                <span
                                  key={v}
                                  className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800"
                                >
                                  {`{{${v}}}`}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => toggleActive(tpl)}
                              disabled={updateMutation.isPending || tpl.id.startsWith("seed-")}
                              role="switch"
                              aria-checked={tpl.is_active}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                tpl.is_active ? "bg-green-500" : "bg-gray-300 dark:bg-slate-600"
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                                  tpl.is_active ? "translate-x-[18px]" : "translate-x-[3px]"
                                }`}
                              />
                            </button>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => startEdit(tpl)}
                                disabled={tpl.id.startsWith("seed-")}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/15"
                                onClick={() => deleteMutation.mutate(tpl.id)}
                                disabled={deleteMutation.isPending || tpl.id.startsWith("seed-")}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                  {templates.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-muted-foreground/60">
                        No templates configured
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add new template form */}
            <div className="border rounded-lg p-3 bg-gray-50/50 dark:bg-slate-800/30 space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Plus className="h-3 w-3" />
                Add Template
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input
                  value={newTemplate.name}
                  onChange={(e) => setNewTemplate({ ...newTemplate, name: e.target.value })}
                  className="rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                  placeholder="Template name"
                />
                <input
                  value={newTemplate.template_id}
                  onChange={(e) => setNewTemplate({ ...newTemplate, template_id: e.target.value })}
                  className="rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                  placeholder="MSG91/WhatsApp template ID"
                />
                <input
                  value={newTemplate.description}
                  onChange={(e) => setNewTemplate({ ...newTemplate, description: e.target.value })}
                  className="rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                  placeholder="Description (optional)"
                />
                <input
                  value={newTemplate.variablesStr}
                  onChange={(e) => setNewTemplate({ ...newTemplate, variablesStr: e.target.value })}
                  className="rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                  placeholder="Variables (comma-separated, e.g. Name, Date)"
                />
              </div>
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 bg-green-600 hover:bg-green-700"
                onClick={handleCreate}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                Add Template
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// --- Main Notifications Content ---

function NotificationsContent() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<"send" | "history">("send")

  // --- Send form state ---
  const [channel, setChannel] = useState<"email" | "whatsapp" | "both">("email")
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedState, setSelectedState] = useState("")
  const [selectedZone, setSelectedZone] = useState("")
  const [incompleteOnly, setIncompleteOnly] = useState(false)
  const [subject, setSubject] = useState("")
  const [message, setMessage] = useState("")
  const [template, setTemplate] = useState("")
  const [showConfirm, setShowConfirm] = useState(false)

  // Fetch dynamic WhatsApp templates
  const { data: waTemplates = [] } = useQuery<WhatsAppTemplate[]>({
    queryKey: ["whatsapp-templates"],
    queryFn: async () => {
      const res = await fetch("/api/whatsapp-templates")
      if (!res.ok) return []
      return res.json()
    },
  })
  const activeTemplates = waTemplates.filter((t) => t.is_active)

  // Build filter object
  const filter = {
    membershipType: selectedTypes.length > 0 ? selectedTypes : undefined,
    state: selectedState || undefined,
    zone: selectedZone || undefined,
    hasIncompleteProfile: incompleteOnly || undefined,
  }

  // Count query
  const { data: countData, isLoading: countLoading } = useQuery({
    queryKey: ["notification-count", filter],
    queryFn: async () => {
      const res = await fetch("/api/notifications/count", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
      })
      return res.json()
    },
    refetchOnWindowFocus: false,
  })

  const memberCount = countData?.count ?? 0

  // History query
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ["notification-history"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/history")
      return res.json()
    },
    enabled: tab === "history",
  })

  // Send mutation
  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: channel,
          filter,
          subject: channel !== "whatsapp" ? subject : undefined,
          message: channel !== "whatsapp" ? message : undefined,
          template: channel !== "email" ? template : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.status) throw new Error(data.message || "Failed to send")
      return data
    },
    onSuccess: (data) => {
      toast.success(`Sent to ${data.sent} of ${data.total} members`)
      queryClient.invalidateQueries({ queryKey: ["notification-history"] })
      setShowConfirm(false)
      // Reset form
      setSubject("")
      setMessage("")
      setTemplate("")
    },
    onError: (err: Error) => {
      toast.error(err.message)
      setShowConfirm(false)
    },
  })

  const toggleType = (t: string) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    )
  }

  const canSend =
    memberCount > 0 &&
    ((channel === "email" && subject && message) ||
      (channel === "whatsapp" && template) ||
      (channel === "both" && subject && message && template))

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Bell className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Bulk Notifications</h1>
          <p className="text-sm text-muted-foreground">Send emails and WhatsApp messages to members</p>
        </div>
        <WhatsAppTemplatesDialog />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b">
        <button
          onClick={() => setTab("send")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "send"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Send className="h-4 w-4 inline mr-2" />
          Send New
        </button>
        <button
          onClick={() => setTab("history")}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            tab === "history"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4 inline mr-2" />
          History
        </button>
      </div>

      {/* Send Tab */}
      {tab === "send" && (
        <div className="space-y-6">
          {/* Filters */}
          <div className="rounded-xl border bg-card p-6 space-y-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Filter Recipients
            </h2>

            {/* Membership Type checkboxes */}
            <div>
              <label className="text-sm font-medium mb-2 block">Membership Type</label>
              <div className="flex flex-wrap gap-3">
                {MEMBERSHIP_TYPES.map((t) => (
                  <label
                    key={t}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                      selectedTypes.includes(t)
                        ? "bg-primary/10 border-primary text-primary"
                        : "bg-background hover:bg-accent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTypes.includes(t)}
                      onChange={() => toggleType(t)}
                      className="sr-only"
                    />
                    <span className="text-sm font-medium">{t}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* State & Zone */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">State</label>
                <select
                  value={selectedState}
                  onChange={(e) => setSelectedState(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <option value="">All States</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Zone</label>
                <select
                  value={selectedZone}
                  onChange={(e) => setSelectedZone(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <option value="">All Zones</option>
                  {ZONES.map((z) => (
                    <option key={z} value={z}>{z}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Incomplete profiles toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <button
                type="button"
                role="switch"
                aria-checked={incompleteOnly}
                onClick={() => setIncompleteOnly(!incompleteOnly)}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                  incompleteOnly ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg transition-transform ${
                    incompleteOnly ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <span className="text-sm font-medium">Incomplete Profiles Only</span>
            </label>

            {/* Preview count */}
            <div className="rounded-lg bg-muted/50 px-4 py-3 flex items-center gap-2">
              {countLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-2xl font-bold text-primary">{memberCount}</span>
              )}
              <span className="text-sm text-muted-foreground">
                {memberCount === 1 ? "member" : "members"} will receive this notification
                {memberCount > 500 && (
                  <span className="text-amber-600 font-medium ml-1">(max 500 per batch)</span>
                )}
              </span>
            </div>
          </div>

          {/* Channel selection */}
          <div className="rounded-xl border bg-card p-6 space-y-5">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Channel
            </h2>
            <div className="flex flex-wrap gap-3">
              {(
                [
                  { value: "email", label: "Email", icon: Mail },
                  { value: "whatsapp", label: "WhatsApp", icon: MessageSquare },
                  { value: "both", label: "Both", icon: Send },
                ] as const
              ).map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                    channel === value
                      ? "bg-primary/10 border-primary text-primary"
                      : "bg-background hover:bg-accent"
                  }`}
                >
                  <input
                    type="radio"
                    name="channel"
                    value={value}
                    checked={channel === value}
                    onChange={() => setChannel(value)}
                    className="sr-only"
                  />
                  <Icon className="h-4 w-4" />
                  <span className="text-sm font-medium">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Email fields */}
          {(channel === "email" || channel === "both") && (
            <div className="rounded-xl border bg-card p-6 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Email Content
              </h2>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Subject</label>
                <Input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Important update from AMASI"
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Message</label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Type your message here... The greeting 'Dear [Name]' is added automatically."
                  rows={8}
                />
              </div>
            </div>
          )}

          {/* WhatsApp fields */}
          {(channel === "whatsapp" || channel === "both") && (
            <div className="rounded-xl border bg-card p-6 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                WhatsApp Template
              </h2>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Template</label>
                <select
                  value={template}
                  onChange={(e) => setTemplate(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Select a template</option>
                  {activeTemplates.map((t) => (
                    <option key={t.template_id} value={t.template_id}>{t.name}</option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">
                WhatsApp messages use pre-approved templates. The member&apos;s name is passed automatically.
              </p>
            </div>
          )}

          {/* Send button */}
          <div className="flex justify-end">
            <Button
              size="lg"
              disabled={!canSend || sendMutation.isPending}
              onClick={() => setShowConfirm(true)}
              className="gap-2"
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              Send Notification
            </Button>
          </div>

          {/* Result display */}
          {sendMutation.isSuccess && sendMutation.data && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-400/30 bg-emerald-50 dark:bg-emerald-500/15 p-4 flex items-start gap-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-emerald-800 dark:text-emerald-300">Notification sent successfully</p>
                <p className="text-sm text-emerald-700 dark:text-emerald-400 mt-1">
                  Sent: {sendMutation.data.sent} | Failed: {sendMutation.data.failed} | Total: {sendMutation.data.total}
                </p>
              </div>
            </div>
          )}

          {sendMutation.isError && (
            <div className="rounded-xl border border-red-200 dark:border-red-400/30 bg-red-50 dark:bg-red-500/15 p-4 flex items-start gap-3">
              <XCircle className="h-5 w-5 text-red-600 dark:text-red-300 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium text-red-800 dark:text-red-300">Failed to send</p>
                <p className="text-sm text-red-700 dark:text-red-400 mt-1">{(sendMutation.error as Error).message}</p>
              </div>
            </div>
          )}

          {/* Confirmation dialog */}
          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                  Confirm Send
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to send {channel === "both" ? "emails and WhatsApp messages" : channel === "email" ? "emails" : "WhatsApp messages"} to{" "}
                <strong className="text-foreground">{Math.min(memberCount, 500)}</strong> members?
                {memberCount > 500 && (
                  <span className="block mt-1 text-amber-600">
                    Note: Only the first 500 members will be sent (rate limit).
                  </span>
                )}
              </p>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowConfirm(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => sendMutation.mutate()}
                  disabled={sendMutation.isPending}
                  className="gap-2"
                >
                  {sendMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  Yes, Send
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* History Tab */}
      {tab === "history" && (
        <div className="space-y-4">
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : !historyData?.data?.length ? (
            <div className="text-center py-12 text-muted-foreground">
              <History className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No notifications sent yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {historyData.data.map((log: any) => (
                <div
                  key={log.id}
                  className="rounded-xl border bg-card p-4 flex flex-col sm:flex-row sm:items-center gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant="outline"
                        className={
                          log.type === "email"
                            ? "bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-400/30"
                            : log.type === "whatsapp"
                            ? "bg-green-50 dark:bg-green-500/15 text-green-700 dark:text-green-300 border-green-200 dark:border-green-400/30"
                            : "bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-400/30"
                        }
                      >
                        {log.type === "email" ? (
                          <Mail className="h-3 w-3 mr-1" />
                        ) : log.type === "whatsapp" ? (
                          <MessageSquare className="h-3 w-3 mr-1" />
                        ) : (
                          <Send className="h-3 w-3 mr-1" />
                        )}
                        {log.type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-medium truncate">
                      {log.subject || log.message || "Notification"}
                    </p>
                    {log.sent_by && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Sent by {log.sent_by}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm shrink-0">
                    <div className="flex items-center gap-1 text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" />
                      <span className="font-medium">{log.sent_count}</span>
                    </div>
                    {log.failed_count > 0 && (
                      <div className="flex items-center gap-1 text-red-500">
                        <XCircle className="h-4 w-4" />
                        <span className="font-medium">{log.failed_count}</span>
                      </div>
                    )}
                    <span className="text-muted-foreground">/ {log.total_count}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NotificationsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-24">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <NotificationsContent />
    </Suspense>
  )
}
