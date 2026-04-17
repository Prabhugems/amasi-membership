"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
  Settings,
  Loader2,
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { CATEGORIES, ADMIN_ASSIGNEES, PRIORITY_OPTIONS, PRIORITY_CONFIG } from "../lib/constants"
import type { RoutingRule } from "../lib/types"

export function RoutingRulesDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<RoutingRule>>({})
  const [newRule, setNewRule] = useState({ category: "", assigned_to: "", priority_override: "" })

  const { data: rules = [], isLoading } = useQuery<RoutingRule[]>({
    queryKey: ["routing-rules"],
    queryFn: async () => {
      const res = await fetch("/api/routing-rules")
      if (!res.ok) throw new Error("Failed to fetch rules")
      return res.json()
    },
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: async (rule: { category: string; assigned_to: string; priority_override: string }) => {
      const res = await fetch("/api/routing-rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: rule.category,
          assigned_to: rule.assigned_to,
          priority_override: rule.priority_override || null,
        }),
      })
      if (!res.ok) throw new Error("Failed to create rule")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Routing rule created")
      setNewRule({ category: "", assigned_to: "", priority_override: "" })
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] })
    },
    onError: () => toast.error("Failed to create rule"),
  })

  const updateMutation = useMutation({
    mutationFn: async (rule: Partial<RoutingRule> & { id: string }) => {
      const res = await fetch("/api/routing-rules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rule),
      })
      if (!res.ok) throw new Error("Failed to update rule")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Rule updated")
      setEditingId(null)
      setEditForm({})
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] })
    },
    onError: () => toast.error("Failed to update rule"),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/routing-rules?id=${id}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Failed to delete rule")
      return res.json()
    },
    onSuccess: () => {
      toast.success("Rule deleted")
      queryClient.invalidateQueries({ queryKey: ["routing-rules"] })
    },
    onError: () => toast.error("Failed to delete rule"),
  })

  const toggleActive = (rule: RoutingRule) => {
    updateMutation.mutate({ id: rule.id, active: !rule.active })
  }

  const startEdit = (rule: RoutingRule) => {
    setEditingId(rule.id)
    setEditForm({
      category: rule.category,
      assigned_to: rule.assigned_to,
      priority_override: rule.priority_override || "",
    })
  }

  const saveEdit = () => {
    if (!editingId) return
    updateMutation.mutate({
      id: editingId,
      category: editForm.category,
      assigned_to: editForm.assigned_to,
      priority_override: editForm.priority_override || null,
    })
  }

  const handleCreate = () => {
    if (!newRule.category || !newRule.assigned_to) {
      toast.error("Category and Assigned To are required")
      return
    }
    createMutation.mutate(newRule)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 shrink-0 hover:bg-gray-100 dark:hover:bg-slate-800"
          title="Routing Rules"
        >
          <Settings className="h-3.5 w-3.5 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4 text-teal-600" />
            Ticket Routing Rules
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Auto-assign tickets to teams based on category. Rules are applied when a ticket is created.
          </p>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 mt-2">
            {/* Rules table */}
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 dark:bg-slate-800/60 border-b">
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Category</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Assigned To</th>
                    <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Priority Override</th>
                    <th className="text-center px-3 py-2 font-semibold text-muted-foreground">Active</th>
                    <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id} className="border-b last:border-b-0 hover:bg-gray-50/50 dark:hover:bg-slate-800/30">
                      {editingId === rule.id ? (
                        <>
                          <td className="px-3 py-2">
                            <select
                              value={editForm.category || ""}
                              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                              className="w-full rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                            >
                              <option value="">Select...</option>
                              {CATEGORIES.map((c) => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={editForm.assigned_to || ""}
                              onChange={(e) => setEditForm({ ...editForm, assigned_to: e.target.value })}
                              className="w-full rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                            >
                              {ADMIN_ASSIGNEES.filter((a) => a !== "Unassigned").map((a) => (
                                <option key={a} value={a}>{a}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={(editForm.priority_override as string) || ""}
                              onChange={(e) => setEditForm({ ...editForm, priority_override: e.target.value })}
                              className="w-full rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                            >
                              <option value="">None</option>
                              {PRIORITY_OPTIONS.map((p) => (
                                <option key={p} value={p}>{PRIORITY_CONFIG[p]?.label || p}</option>
                              ))}
                            </select>
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
                                onClick={() => { setEditingId(null); setEditForm({}) }}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-3 py-2 font-medium">{rule.category}</td>
                          <td className="px-3 py-2">{rule.assigned_to}</td>
                          <td className="px-3 py-2">
                            {rule.priority_override ? (
                              <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PRIORITY_CONFIG[rule.priority_override]?.className || ""}`}>
                                {PRIORITY_CONFIG[rule.priority_override]?.label || rule.priority_override}
                              </span>
                            ) : (
                              <span className="text-muted-foreground/40">--</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => toggleActive(rule)}
                              disabled={updateMutation.isPending}
                              role="switch"
                              aria-checked={rule.active}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                                rule.active ? "bg-teal-500" : "bg-gray-300 dark:bg-slate-600"
                              }`}
                            >
                              <span
                                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                                  rule.active ? "translate-x-[18px]" : "translate-x-[3px]"
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
                                onClick={() => startEdit(rule)}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                                onClick={() => deleteMutation.mutate(rule.id)}
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
                  {rules.length === 0 && (
                    <tr>
                      <td colSpan={5} className="text-center py-6 text-muted-foreground/60">
                        No routing rules configured
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Add new rule form */}
            <div className="border rounded-lg p-3 bg-gray-50/50 dark:bg-slate-800/30 space-y-2">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest flex items-center gap-1.5">
                <Plus className="h-3 w-3" />
                Add Rule
              </p>
              <div className="grid grid-cols-3 gap-2">
                <select
                  value={newRule.category}
                  onChange={(e) => setNewRule({ ...newRule, category: e.target.value })}
                  className="rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                >
                  <option value="">Category...</option>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                <select
                  value={newRule.assigned_to}
                  onChange={(e) => setNewRule({ ...newRule, assigned_to: e.target.value })}
                  className="rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                >
                  <option value="">Assign to...</option>
                  {ADMIN_ASSIGNEES.filter((a) => a !== "Unassigned").map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
                <select
                  value={newRule.priority_override}
                  onChange={(e) => setNewRule({ ...newRule, priority_override: e.target.value })}
                  className="rounded border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs"
                >
                  <option value="">Priority override (optional)</option>
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>{PRIORITY_CONFIG[p]?.label || p}</option>
                  ))}
                </select>
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
                Add Rule
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
