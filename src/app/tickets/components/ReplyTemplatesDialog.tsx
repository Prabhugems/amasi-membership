"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Settings,
  Zap,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import type { ReplyTemplate } from "../lib/types"

export function ReplyTemplatesDialog({ onTemplatesChanged }: { onTemplatesChanged?: () => void }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{ title: string; body: string }>({ title: "", body: "" })
  const [newTemplate, setNewTemplate] = useState({ title: "", body: "" })

  const { data: templates = [], isLoading } = useQuery<ReplyTemplate[]>({
    queryKey: ["reply-templates-manage"],
    queryFn: async () => {
      const res = await fetch("/api/reply-templates")
      if (!res.ok) throw new Error("Failed to fetch templates")
      return res.json()
    },
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: async (tpl: { title: string; body: string }) => {
      const res = await fetch("/api/reply-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tpl),
      })
      if (!res.ok) throw new Error("Failed to create template")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Template created")
      setNewTemplate({ title: "", body: "" })
      queryClient.invalidateQueries({ queryKey: ["reply-templates-manage"] })
      queryClient.invalidateQueries({ queryKey: ["reply-templates"] })
      onTemplatesChanged?.()
    },
    onError: () => toast.error("Failed to create template"),
  })

  const updateMutation = useMutation({
    mutationFn: async (tpl: { id: string; title?: string; body?: string; active?: boolean; sort_order?: number }) => {
      const res = await fetch("/api/reply-templates", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(tpl),
      })
      if (!res.ok) throw new Error("Failed to update template")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Template updated")
      setEditingId(null)
      setEditForm({ title: "", body: "" })
      queryClient.invalidateQueries({ queryKey: ["reply-templates-manage"] })
      queryClient.invalidateQueries({ queryKey: ["reply-templates"] })
      onTemplatesChanged?.()
    },
    onError: () => toast.error("Failed to update template"),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/reply-templates?id=${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete template")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Template deleted")
      queryClient.invalidateQueries({ queryKey: ["reply-templates-manage"] })
      queryClient.invalidateQueries({ queryKey: ["reply-templates"] })
      onTemplatesChanged?.()
    },
    onError: () => toast.error("Failed to delete template"),
  })

  const toggleActive = (tpl: ReplyTemplate) => {
    updateMutation.mutate({ id: tpl.id, active: !tpl.active })
  }

  const startEdit = (tpl: ReplyTemplate) => {
    setEditingId(tpl.id)
    setEditForm({ title: tpl.title, body: tpl.body })
  }

  const saveEdit = () => {
    if (!editingId) return
    updateMutation.mutate({ id: editingId, title: editForm.title, body: editForm.body })
  }

  const handleCreate = () => {
    if (!newTemplate.title || !newTemplate.body) {
      toast.error("Title and body are required")
      return
    }
    createMutation.mutate(newTemplate)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="text-[10px] text-muted-foreground/60 hover:text-teal-600 transition-colors flex items-center gap-1"
          title="Edit templates"
        >
          <Settings className="h-3 w-3" />
          Edit
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Zap className="h-4 w-4 text-amber-500" />
            Reply Templates
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Manage quick reply templates. Use {"{{member_name}}"} and {"{{ticket_number}}"} as variables.
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
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Title</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Body</th>
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
                            <Input
                              value={editForm.title}
                              onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                              className="h-7 text-xs"
                              placeholder="Title"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Textarea
                              value={editForm.body}
                              onChange={(e) => setEditForm({ ...editForm, body: e.target.value })}
                              className="text-xs min-h-[60px] resize-none"
                              placeholder="Template body..."
                              rows={2}
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
                                className="h-6 w-6 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={saveEdit}
                                disabled={updateMutation.isPending}
                              >
                                <Check className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                                onClick={() => { setEditingId(null); setEditForm({ title: "", body: "" }) }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 font-medium whitespace-nowrap">{tpl.title}</td>
                          <td className="px-3 py-2">
                            <p className="line-clamp-2 text-muted-foreground/70 max-w-[300px]">{tpl.body}</p>
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => toggleActive(tpl)}
                              disabled={updateMutation.isPending}
                              role="switch"
                              aria-checked={tpl.active}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                tpl.active ? "bg-teal-500" : "bg-gray-300 dark:bg-slate-600"
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                                  tpl.active ? "translate-x-[18px]" : "translate-x-[3px]"
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
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                                onClick={() => deleteMutation.mutate(tpl.id)}
                                disabled={deleteMutation.isPending}
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
                      <td colSpan={4} className="text-center py-6 text-muted-foreground/60">
                        No reply templates configured
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
              <div className="space-y-2">
                <Input
                  value={newTemplate.title}
                  onChange={(e) => setNewTemplate({ ...newTemplate, title: e.target.value })}
                  placeholder="Template title (e.g. 'Greeting')"
                  className="h-8 text-xs"
                />
                <Textarea
                  value={newTemplate.body}
                  onChange={(e) => setNewTemplate({ ...newTemplate, body: e.target.value })}
                  placeholder="Template body... Use {{member_name}} and {{ticket_number}} for variables."
                  className="text-xs min-h-[60px] resize-none"
                  rows={2}
                />
              </div>
              <Button
                size="sm"
                className="h-7 text-xs gap-1.5 bg-teal-600 hover:bg-teal-700"
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
