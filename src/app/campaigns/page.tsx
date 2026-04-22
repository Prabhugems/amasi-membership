"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { motion, AnimatePresence } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import {
  Send,
  Mail,
  Users,
  UserCheck,
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  XCircle,
  Calendar,
  Hash,
  RefreshCw,
} from "lucide-react"

interface Recipient {
  email: string
  amasi_number: string
  name: string
  sent_at: string | null
  error?: string
}

interface Campaign {
  id: string
  campaign: string
  total: number
  sent: number
  failed: number
  date: string
  amasi_range: string
  recipients: Recipient[]
  created_at: string
}

interface CampaignStats {
  totalCampaigns: number
  totalEmailsSent: number
  membersUpdated: number
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }) + " " + d.toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  })
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string
  value: number
  icon: typeof Mail
  color: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-3xl font-bold mt-1">{value.toLocaleString()}</p>
            </div>
            <div className={`h-12 w-12 rounded-xl ${color} flex items-center justify-center`}>
              <Icon className="h-6 w-6 text-white" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  )
}

function CampaignCard({ campaign, index }: { campaign: Campaign; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const hasRecipients = campaign.recipients && campaign.recipients.length > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="overflow-hidden">
        <CardContent className="pt-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <Send className="h-4 w-4 text-teal-600 shrink-0" />
                <h3 className="font-semibold text-base truncate">{campaign.campaign}</h3>
              </div>
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatDate(campaign.date)}
                </span>
                <span className="flex items-center gap-1">
                  <Hash className="h-3.5 w-3.5" />
                  {campaign.amasi_range}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">
                <CheckCircle2 className="h-3 w-3 mr-1" />
                {campaign.sent} sent
              </Badge>
              {campaign.failed > 0 && (
                <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">
                  <XCircle className="h-3 w-3 mr-1" />
                  {campaign.failed} failed
                </Badge>
              )}
              {hasRecipients && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExpanded(!expanded)}
                  className="gap-1"
                >
                  {expanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5" />
                      Hide
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5" />
                      View Recipients
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Recipients table */}
          <AnimatePresence>
            {expanded && hasRecipients && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="mt-4 border rounded-lg overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Email</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">AMASI #</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Name</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Sent</th>
                        <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {campaign.recipients.map((r, i) => (
                        <tr key={i} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs">{r.email}</td>
                          <td className="px-4 py-2.5">{r.amasi_number}</td>
                          <td className="px-4 py-2.5">{r.name}</td>
                          <td className="px-4 py-2.5 text-muted-foreground">
                            {r.sent_at ? formatDate(r.sent_at) : "-"}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.error ? (
                              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-xs dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30">
                                Failed
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30">
                                Sent
                              </Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>
    </motion.div>
  )
}

export default function CampaignsPage() {
  const queryClient = useQueryClient()

  const { data, isLoading, error } = useQuery<{
    campaigns: Campaign[]
    stats: CampaignStats
  }>({
    queryKey: ["campaigns"],
    queryFn: async () => {
      const res = await fetch("/api/campaigns")
      if (!res.ok) throw new Error("Failed to load campaigns")
      return res.json()
    },
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_profile_update" }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || "Failed to send campaign")
      }
      return res.json()
    },
    onSuccess: (result) => {
      toast.success(`Campaign sent: ${result.sent} emails delivered, ${result.failed} failed`)
      queryClient.invalidateQueries({ queryKey: ["campaigns"] })
    },
    onError: (err: Error) => {
      toast.error(err.message)
    },
  })

  const campaigns = data?.campaigns ?? []
  const stats = data?.stats ?? { totalCampaigns: 0, totalEmailsSent: 0, membersUpdated: 0 }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Send className="h-6 w-6 text-teal-600" />
            Email Campaigns
          </h1>
          <p className="text-muted-foreground mt-1">
            Track sent campaigns and member responses
          </p>
        </div>
        <Button
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending}
          className="bg-teal-600 hover:bg-teal-700 gap-2"
        >
          {sendMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          {sendMutation.isPending ? "Sending..." : "Send Profile Update Campaign"}
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          label="Total Campaigns Sent"
          value={stats.totalCampaigns}
          icon={Send}
          color="bg-teal-600"
        />
        <StatCard
          label="Total Emails Sent"
          value={stats.totalEmailsSent}
          icon={Mail}
          color="bg-blue-600"
        />
        <StatCard
          label="Members Updated"
          value={stats.membersUpdated}
          icon={UserCheck}
          color="bg-emerald-600"
        />
      </div>

      {/* Loading / Error states */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      )}

      {error && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>Failed to load campaigns. Please try again.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Campaign list */}
      {!isLoading && !error && campaigns.length === 0 && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8 text-muted-foreground">
              <Mail className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No campaigns sent yet</p>
              <p className="text-sm mt-1">
                Click "Send Profile Update Campaign" to send the first batch.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!isLoading && campaigns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Campaign History</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["campaigns"] })}
              className="gap-1 text-muted-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
          {campaigns.map((campaign, index) => (
            <CampaignCard key={campaign.id} campaign={campaign} index={index} />
          ))}
        </div>
      )}
    </div>
  )
}
