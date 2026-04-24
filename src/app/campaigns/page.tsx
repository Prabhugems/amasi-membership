"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Send, Mail, UserCheck, Loader2, AlertCircle, CheckCircle2, XCircle,
  Calendar, RefreshCw, Play,
} from "lucide-react"

interface TemplateOption {
  key: string
  name: string
  category: "marketing" | "statutory"
  targetFields: string[]
}

interface CampaignSummary {
  id: string
  name: string
  template_key: string
  category: string
  status: string
  created_at: string
  completed_at: string | null
  total: number
  sent: number
  failed: number
  pending: number
  credited: number
}

interface CampaignsResponse {
  campaigns: CampaignSummary[]
  templates: TemplateOption[]
  stats: { totalCampaigns: number; totalEmailsSent: number; membersUpdated: number }
}

function formatDate(s: string) {
  const d = new Date(s)
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })
}

function StatCard({ label, value, icon: Icon, color }: {
  label: string; value: number; icon: typeof Mail; color: string
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
      <Card><CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
          </div>
          <div className={`h-12 w-12 rounded-xl ${color} flex items-center justify-center`}>
            <Icon className="h-6 w-6 text-white" />
          </div>
        </div>
      </CardContent></Card>
    </motion.div>
  )
}

export default function CampaignsPage() {
  const qc = useQueryClient()
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [sendingId, setSendingId] = useState<string | null>(null)

  const { data, isLoading, error } = useQuery<CampaignsResponse>({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const res = await fetch("/api/campaigns")
      if (!res.ok) throw new Error("Failed to load campaigns")
      return res.json()
    },
  })

  const createMut = useMutation({
    mutationFn: async (templateKey: string) => {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateKey }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Create failed")
      return res.json()
    },
    onSuccess: (r) => {
      toast.success(`Campaign created: ${r.totalRecipients} recipients`)
      qc.invalidateQueries({ queryKey: ["campaigns"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const sendMut = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/campaigns/${id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Send failed")
      return res.json()
    },
    onMutate: (id: string) => { setSendingId(id) },
    onSettled: () => { setSendingId(null) },
    onSuccess: (r) => {
      toast.success(`Batch: ${r.sent} sent, ${r.failed} failed, ${r.remaining} remaining`)
      qc.invalidateQueries({ queryKey: ["campaigns"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const campaigns = data?.campaigns ?? []
  const templates = data?.templates ?? []
  const stats = data?.stats ?? { totalCampaigns: 0, totalEmailsSent: 0, membersUpdated: 0 }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Send className="h-6 w-6 text-teal-600" />
            Email Campaigns
          </h1>
          <p className="text-muted-foreground mt-1">Track sent campaigns and member responses</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="border rounded-md px-3 py-2 text-sm bg-background"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
          >
            <option value="">Select template…</option>
            {templates.map((t) => (
              <option key={t.key} value={t.key}>{t.name} ({t.category})</option>
            ))}
          </select>
          <Button
            onClick={() => selectedTemplate && createMut.mutate(selectedTemplate)}
            disabled={!selectedTemplate || createMut.isPending}
            className="bg-teal-600 hover:bg-teal-700 gap-2"
          >
            {createMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Create campaign
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Campaigns" value={stats.totalCampaigns} icon={Send} color="bg-teal-600" />
        <StatCard label="Emails Sent" value={stats.totalEmailsSent} icon={Mail} color="bg-blue-600" />
        <StatCard label="Members Updated (credited)" value={stats.membersUpdated} icon={UserCheck} color="bg-emerald-600" />
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}
      {error && (
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>Failed to load campaigns.</p>
          </div>
        </CardContent></Card>
      )}

      {!isLoading && campaigns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Campaign History</h2>
            <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ["campaigns"] })}
                    className="gap-1 text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </div>
          {campaigns.map((c, i) => (
            <motion.div key={c.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: i * 0.05 }}>
              <Card><CardContent className="pt-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Send className="h-4 w-4 text-teal-600 shrink-0" />
                      <h3 className="font-semibold text-base truncate">{c.name}</h3>
                      <Badge variant="outline" className="text-xs">{c.status}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" />{formatDate(c.created_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">{c.total} total</Badge>
                    <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">
                      <CheckCircle2 className="h-3 w-3 mr-1" />{c.sent} sent
                    </Badge>
                    {c.failed > 0 && (
                      <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                        <XCircle className="h-3 w-3 mr-1" />{c.failed} failed
                      </Badge>
                    )}
                    <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200">{c.pending} pending</Badge>
                    <Badge variant="outline" className="bg-indigo-50 text-indigo-800 border-indigo-200">{c.credited} credited</Badge>
                    {c.status !== "completed" && c.pending > 0 && (
                      <Button size="sm" variant="outline" className="gap-1"
                              onClick={() => sendMut.mutate(c.id)}
                              disabled={sendingId === c.id}>
                        {sendingId === c.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Play className="h-3.5 w-3.5" />}
                        Send next batch
                      </Button>
                    )}
                  </div>
                </div>
              </CardContent></Card>
            </motion.div>
          ))}
        </div>
      )}

      {!isLoading && !error && campaigns.length === 0 && (
        <Card><CardContent className="pt-6">
          <div className="text-center py-8 text-muted-foreground">
            <Mail className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No campaigns yet</p>
            <p className="text-sm mt-1">Pick a template and create one above.</p>
          </div>
        </CardContent></Card>
      )}
    </div>
  )
}
