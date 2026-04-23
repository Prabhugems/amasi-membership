"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogClose,
} from "@/components/ui/dialog"
import { KeyRound, Plus, Trash2, Loader2, Copy, CheckCircle, AlertTriangle, X } from "lucide-react"
import { toast } from "sonner"

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  status: "active" | "revoked"
  created_at: string
  created_by: string | null
  last_used_at: string | null
  revoked_at: string | null
}

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  try { return new Date(iso).toLocaleString() } catch { return iso }
}

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [formName, setFormName] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const loadKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/admin/api-keys")
      if (res.status === 401) {
        setAuthorized(false)
        return
      }
      const json = await res.json()
      if (!json.status) throw new Error(json.error || "Failed to load API keys")
      setKeys(json.data || [])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load API keys")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadKeys() }, [loadKeys])

  const handleCreate = async () => {
    const name = formName.trim()
    if (!name) {
      toast.error("Please enter a name for the key")
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch("/api/admin/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      })
      const json = await res.json()
      if (!json.status) throw new Error(json.error || "Failed to create key")
      setNewlyCreatedKey(json.data.raw_key)
      setFormName("")
      setShowCreate(false)
      await loadKeys()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key")
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (id: string, name: string) => {
    if (!confirm(`Revoke the API key "${name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/api-keys/${id}`, { method: "DELETE" })
      const json = await res.json()
      if (!json.status) throw new Error(json.error || "Failed to revoke")
      toast.success("API key revoked")
      await loadKeys()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key")
    }
  }

  const handleCopy = () => {
    if (!newlyCreatedKey) return
    navigator.clipboard.writeText(newlyCreatedKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (!authorized) {
    return (
      <div className="max-w-3xl mx-auto py-16 text-center space-y-3">
        <AlertTriangle className="h-10 w-10 mx-auto text-amber-500" />
        <h2 className="text-xl font-semibold">Admin access required</h2>
        <p className="text-sm text-muted-foreground">Please sign in to manage API keys.</p>
        <a href="/admin"><Button size="sm">Go to Admin</Button></a>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 py-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <KeyRound className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">API Keys</h2>
            <p className="text-sm text-muted-foreground">
              Issue keys to external partners for the member lookup API.
            </p>
          </div>
        </div>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Key
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Active & Revoked Keys</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          ) : keys.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No API keys yet. Click <strong>New Key</strong> to create one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground uppercase">
                    <th className="py-2 pr-4">Name</th>
                    <th className="py-2 pr-4">Prefix</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2 pr-4">Last Used</th>
                    <th className="py-2 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} className="border-b last:border-0">
                      <td className="py-3 pr-4 font-medium">{k.name}</td>
                      <td className="py-3 pr-4 font-mono text-xs text-muted-foreground">{k.key_prefix}…</td>
                      <td className="py-3 pr-4">
                        <Badge variant={k.status === "active" ? "success" : "secondary"}>
                          {k.status}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(k.created_at)}</td>
                      <td className="py-3 pr-4 text-xs text-muted-foreground">{formatDate(k.last_used_at)}</td>
                      <td className="py-3 pr-4 text-right">
                        {k.status === "active" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRevoke(k.id, k.name)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-muted/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">How to use the API</CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3 text-muted-foreground">
          <p>Give the consuming team their raw key and this endpoint:</p>
          <pre className="bg-background border rounded-md p-3 text-xs overflow-x-auto">
{`GET https://membership.amasi.org/api/v1/members/{amasi_number}
Authorization: Bearer <api_key>`}
          </pre>
          <p>
            Returns <code className="text-xs">name, email, mobile, amasi_number, city, state</code> for active members only.
            Rate limit: 60 requests/minute per key.
          </p>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create API Key</DialogTitle>
            <DialogDescription>
              Give this key a descriptive name so you can identify which partner or service is using it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="e.g. Events360 team"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              disabled={submitting}
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline" size="sm" disabled={submitting}>Cancel</Button>
            </DialogClose>
            <Button size="sm" onClick={handleCreate} disabled={submitting || !formName.trim()}>
              {submitting ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Plus className="h-4 w-4 mr-1.5" />}
              Create Key
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reveal-once dialog */}
      <Dialog open={!!newlyCreatedKey} onOpenChange={(open) => { if (!open) setNewlyCreatedKey(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle className="h-5 w-5 text-green-600" />
              API Key Created
            </DialogTitle>
            <DialogDescription>
              Copy this key now — it will not be shown again. If lost, revoke it and create a new one.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="bg-muted rounded-md p-3 font-mono text-sm break-all border">
              {newlyCreatedKey}
            </div>
            <Button onClick={handleCopy} variant="outline" size="sm" className="w-full">
              {copied ? (
                <><CheckCircle className="h-4 w-4 mr-1.5 text-green-600" />Copied</>
              ) : (
                <><Copy className="h-4 w-4 mr-1.5" />Copy to clipboard</>
              )}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setNewlyCreatedKey(null)}>
              <X className="h-4 w-4 mr-1.5" />
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
