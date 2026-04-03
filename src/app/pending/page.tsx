"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  CheckCircle, XCircle, Eye, Clock, Sparkles, AlertCircle,
  Search, FileText, Shield, Loader2, Inbox,
} from "lucide-react"
import { toast } from "sonner"
import { formatDate, getInitials } from "@/lib/utils"

type TabFilter = "pending" | "ai_approved" | "approved" | "rejected" | "all"

const TAB_STYLES: Record<TabFilter, { icon: typeof Clock; activeClass: string; dotColor: string }> = {
  pending: { icon: Clock, activeClass: "bg-amber-600 text-white border-amber-600", dotColor: "bg-amber-500" },
  ai_approved: { icon: Sparkles, activeClass: "bg-blue-600 text-white border-blue-600", dotColor: "bg-blue-500" },
  approved: { icon: CheckCircle, activeClass: "bg-emerald-600 text-white border-emerald-600", dotColor: "bg-emerald-500" },
  rejected: { icon: XCircle, activeClass: "bg-red-600 text-white border-red-600", dotColor: "bg-red-500" },
  all: { icon: FileText, activeClass: "bg-gray-800 text-white border-gray-800", dotColor: "bg-gray-500" },
}

export default function PendingPage() {
  const [tab, setTab] = useState<TabFilter>("pending")
  const [search, setSearch] = useState("")
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [approveNotes, setApproveNotes] = useState("")
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ["applications", tab],
    queryFn: async () => {
      const res = await fetch(`/api/applications/list?status=${tab}&limit=100`)
      return res.json()
    },
  })

  const approveMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) => {
      const res = await fetch("/api/applications/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, notes }),
      })
      return res.json()
    },
    onSuccess: (data) => {
      if (data.status) {
        toast.success(data.message)
        queryClient.invalidateQueries({ queryKey: ["applications"] })
        setExpandedId(null)
      } else {
        toast.error(data.message)
      }
    },
  })

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const res = await fetch("/api/applications/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: id, reason }),
      })
      return res.json()
    },
    onSuccess: (data) => {
      if (data.status) {
        toast.success(data.message)
        queryClient.invalidateQueries({ queryKey: ["applications"] })
        setExpandedId(null)
        setRejectReason("")
      } else {
        toast.error(data.message)
      }
    },
  })

  const applications = (data?.data || []).filter((app: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      app.name?.toLowerCase().includes(q) ||
      app.first_name?.toLowerCase().includes(q) ||
      app.email?.toLowerCase().includes(q) ||
      app.phone?.includes(q) ||
      app.reference_number?.toLowerCase().includes(q)
    )
  })

  const tabs: { key: TabFilter; label: string }[] = [
    { key: "pending", label: "Pending Review" },
    { key: "ai_approved", label: "AI Approved" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Application Approvals</h2>
        <p className="text-muted-foreground mt-1">
          Review, approve, or reject membership applications
        </p>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((t) => {
          const style = TAB_STYLES[t.key]
          const isActive = tab === t.key
          const TabIcon = style.icon
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all ${
                isActive
                  ? style.activeClass + " shadow-sm"
                  : "bg-card border-border hover:bg-accent text-muted-foreground hover:text-foreground"
              }`}
            >
              <TabIcon className="h-4 w-4" />
              {t.label}
              {data?.data && t.key !== "all" && (
                <span className={`inline-flex items-center justify-center h-5 min-w-5 px-1.5 text-xs font-bold rounded-full ${
                  isActive ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"
                }`}>
                  {(data.data || []).filter((a: any) => {
                    if (t.key === "pending") return ["submitted", "pending_review"].includes(a.status)
                    return a.status === t.key
                  }).length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name, email, phone, reference..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-11 shadow-sm"
        />
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground mr-2" />
          <span className="text-muted-foreground">Loading applications...</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && applications.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <Inbox className="h-14 w-14 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-lg font-semibold">No applications in this category</p>
            <p className="text-sm text-muted-foreground mt-1">All caught up!</p>
          </CardContent>
        </Card>
      )}

      {/* Application cards */}
      <div className="space-y-3">
        {applications.map((app: any) => {
          const isExpanded = expandedId === app.id
          const fullName = [app.salutation, app.first_name, app.middle_name, app.last_name].filter(Boolean).join(" ") || app.name
          const aiFlags = app.ai_flags || []
          const docs = app.documents || {}

          const borderClass = app.needs_manual_review
            ? "border-l-4 border-l-amber-400"
            : app.ai_verified
              ? "border-l-4 border-l-emerald-400"
              : app.status === "rejected"
                ? "border-l-4 border-l-red-400"
                : app.status === "approved"
                  ? "border-l-4 border-l-emerald-400"
                  : app.status === "ai_approved"
                    ? "border-l-4 border-l-blue-400"
                    : ""

          return (
            <Card key={app.id} className={`transition-all hover:shadow-md ${borderClass}`}>
              <CardContent className="p-5">
                {/* Summary row */}
                <div className="flex items-center gap-4">
                  <Avatar className="h-12 w-12 shrink-0 border shadow-sm">
                    <AvatarFallback className="text-sm font-semibold bg-primary/5 text-primary">
                      {getInitials(fullName)}
                    </AvatarFallback>
                  </Avatar>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-sm">{fullName}</p>
                      <Badge variant={
                        app.status === "approved" || app.status === "ai_approved" ? "success" :
                        app.status === "rejected" ? "destructive" :
                        "warning"
                      } className="text-xs">
                        {app.status === "ai_approved" ? "AI Approved" :
                         app.status === "pending_review" ? "Needs Review" :
                         app.status === "submitted" ? "Submitted" :
                         app.status}
                      </Badge>
                      {app.ai_confidence && (
                        <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full border ${
                          app.ai_confidence.includes("high") ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                          app.ai_confidence.includes("medium") ? "bg-amber-50 text-amber-700 border-amber-200" :
                          "bg-red-50 text-red-700 border-red-200"
                        }`}>
                          <Sparkles className="h-3 w-3" />
                          {app.ai_confidence}
                        </span>
                      )}
                      {app.needs_manual_review && (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          <AlertCircle className="h-3 w-3" />
                          Manual Review
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground flex-wrap">
                      <span className="font-medium">{app.email}</span>
                      <span className="text-border">|</span>
                      <span>{app.phone}</span>
                      <span className="text-border">|</span>
                      <span className="font-semibold">{app.membership_type}</span>
                      <span className="text-border">|</span>
                      <span className="font-mono">{app.reference_number}</span>
                      <span className="text-border">|</span>
                      <span>{formatDate(app.created_at)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {(app.status === "submitted" || app.status === "pending_review" || app.status === "ai_approved") && (
                      <>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm h-9 px-4"
                          onClick={() => approveMutation.mutate({ id: app.id, notes: "Approved" })}
                          disabled={approveMutation.isPending}
                        >
                          <CheckCircle className="h-4 w-4 mr-1.5" /> Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600 border-red-200 hover:bg-red-50 shadow-sm h-9 px-4"
                          onClick={() => { setExpandedId(isExpanded ? null : app.id); setRejectReason("") }}
                        >
                          <XCircle className="h-4 w-4 mr-1.5" /> Reject
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setExpandedId(isExpanded ? null : app.id)}
                      className={`h-9 w-9 p-0 ${isExpanded ? "bg-accent" : ""}`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div className="mt-5 pt-5 border-t space-y-5">
                    {/* AI Flags */}
                    {aiFlags.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <p className="text-sm font-bold text-amber-800 mb-2 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4" /> AI Flags
                        </p>
                        <div className="space-y-1">
                          {aiFlags.map((flag: string, i: number) => (
                            <p key={i} className="text-sm text-amber-700 flex items-start gap-2">
                              <span className="shrink-0 mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500" />
                              {flag}
                            </p>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Details grid */}
                    <div className="grid gap-5 sm:grid-cols-3">
                      <div className="bg-muted/40 rounded-xl p-4 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Personal</p>
                        <p className="font-semibold text-sm">{fullName}</p>
                        <p className="text-sm text-muted-foreground">{app.gender} &middot; DOB: {formatDate(app.date_of_birth)}</p>
                        <p className="text-sm text-muted-foreground">Father: {app.father_name || "N/A"}</p>
                        <p className="text-sm text-muted-foreground">{[app.city, app.state].filter(Boolean).join(", ")}</p>
                      </div>
                      <div className="bg-muted/40 rounded-xl p-4 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Education</p>
                        <p className="font-semibold text-sm">{app.pg_degree || "N/A"}</p>
                        <p className="text-sm text-muted-foreground">{app.pg_college}</p>
                        <p className="text-sm text-muted-foreground">{app.pg_university} ({app.pg_year})</p>
                      </div>
                      <div className="bg-muted/40 rounded-xl p-4 space-y-2">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Registration</p>
                        <p className="font-semibold text-sm">MCI: {app.mci_council_number || "N/A"}</p>
                        <p className="text-sm text-muted-foreground">{app.mci_council_state}</p>
                        {app.asi_membership_no && <p className="text-sm font-medium">ASI: {app.asi_membership_no}</p>}
                        <div className="pt-1">
                          <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${
                            app.payment_status === "paid"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-red-50 text-red-700 border border-red-200"
                          }`}>
                            {app.payment_status === "paid" ? "Paid" : "Unpaid"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Documents */}
                    {Object.keys(docs).length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Documents</p>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(docs).map(([key, doc]: [string, any]) => (
                            <div key={key} className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border ${
                              doc.status === "extracted" ? "bg-emerald-50 border-emerald-200 text-emerald-700" :
                              doc.status === "uploaded" ? "bg-amber-50 border-amber-200 text-amber-700" :
                              "bg-red-50 border-red-200 text-red-700"
                            }`}>
                              {doc.status === "extracted" ? <CheckCircle className="h-3.5 w-3.5" /> :
                               doc.status === "uploaded" ? <Clock className="h-3.5 w-3.5" /> :
                               <AlertCircle className="h-3.5 w-3.5" />}
                              {key.replace(/_/g, " ")}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* OCR extracted data */}
                    {app.ocr_data && Object.keys(app.ocr_data).length > 0 && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">AI Extracted Data</p>
                        <div className="bg-muted/50 rounded-xl p-4 text-xs space-y-1.5 max-h-40 overflow-auto font-mono">
                          {Object.entries(app.ocr_data).map(([docType, extracted]: [string, any]) => (
                            <div key={docType}>
                              <span className="font-bold text-foreground">{docType}:</span>{" "}
                              <span className="text-muted-foreground">
                                {Object.entries(extracted || {})
                                  .filter(([k]) => k !== "is_valid_medical_document" && k !== "rejection_reason")
                                  .map(([k, v]) => `${k}=${v}`)
                                  .join(", ")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Assigned number */}
                    {app.assigned_amasi_number && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                          <Shield className="h-5 w-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-emerald-800">AMASI #{app.assigned_amasi_number}</p>
                          <p className="text-xs text-emerald-600">{app.review_notes}</p>
                        </div>
                      </div>
                    )}

                    {/* Reject form */}
                    {(app.status === "submitted" || app.status === "pending_review" || app.status === "ai_approved") && (
                      <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-3">
                        <Label className="text-sm font-semibold text-red-700">Rejection Reason (required)</Label>
                        <Input
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="e.g. Invalid MCI certificate, degree not verified..."
                          className="border-red-200 bg-white"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            className="shadow-sm"
                            onClick={() => rejectMutation.mutate({ id: app.id, reason: rejectReason })}
                            disabled={!rejectReason.trim() || rejectMutation.isPending}
                          >
                            {rejectMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <XCircle className="h-4 w-4 mr-1.5" />}
                            Confirm Rejection
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setExpandedId(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}

                    {/* Approve with notes */}
                    {(app.status === "submitted" || app.status === "pending_review") && (
                      <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-3">
                        <Label className="text-sm font-semibold text-emerald-700">Approval Notes (optional)</Label>
                        <Input
                          value={approveNotes}
                          onChange={(e) => setApproveNotes(e.target.value)}
                          placeholder="e.g. Documents verified manually..."
                          className="border-emerald-200 bg-white"
                        />
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 shadow-sm"
                          onClick={() => approveMutation.mutate({ id: app.id, notes: approveNotes || "Manually approved" })}
                          disabled={approveMutation.isPending}
                        >
                          {approveMutation.isPending ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-1.5" />}
                          Approve & Assign Membership Number
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Total count */}
      {data?.total > 0 && (
        <p className="text-sm text-muted-foreground text-center pt-2">
          Showing {applications.length} of {data.total} applications
        </p>
      )}
    </div>
  )
}
