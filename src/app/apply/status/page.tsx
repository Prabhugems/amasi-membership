"use client"

import { Suspense, useState, useEffect } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Search, Loader2, FileSearch, Award } from "lucide-react"
import { formatDate } from "@/lib/utils"

interface ApplicationData {
  id: string
  reference_number: string
  name: string
  first_name: string
  middle_name: string
  last_name: string
  salutation: string
  membership_type: string
  status: string
  payment_status: string
  ai_confidence: string | null
  ai_verified: boolean
  needs_manual_review: boolean
  review_notes: string | null
  assigned_amasi_number: number | null
  created_at: string
  reviewed_at: string | null
}

function statusBadgeVariant(status: string) {
  switch (status) {
    case "approved":
      return "success" as const
    case "rejected":
      return "destructive" as const
    case "ai_approved":
      return "success" as const
    case "pending_review":
    case "submitted":
      return "warning" as const
    default:
      return "secondary" as const
  }
}

function statusLabel(status: string) {
  switch (status) {
    case "approved":
      return "Approved"
    case "rejected":
      return "Rejected"
    case "ai_approved":
      return "AI Approved"
    case "pending_review":
      return "Under Review"
    case "submitted":
      return "Submitted"
    default:
      return status
  }
}

function paymentLabel(status: string) {
  switch (status) {
    case "paid":
      return "Paid"
    case "pending":
      return "Pending"
    case "failed":
      return "Failed"
    default:
      return status
  }
}

function membershipTypeLabel(type: string) {
  switch (type) {
    case "LM":
      return "Life Member"
    case "ALM":
      return "Associate Life Member"
    case "ACM":
      return "Associate Candidate Member"
    case "ILM":
      return "International Life Member"
    default:
      return type
  }
}

function StatusContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const refParam = searchParams.get("ref") || ""

  const [query, setQuery] = useState(refParam)
  const [searchRef, setSearchRef] = useState(refParam)
  const [data, setData] = useState<ApplicationData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!searchRef) return

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setData(null)

    fetch(`/api/applications/status?ref=${encodeURIComponent(searchRef)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return
        if (json.status) {
          setData(json.data)
        } else {
          setError(json.message || "Application not found")
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to fetch application status")
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [searchRef])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    setSearchRef(trimmed)
    router.replace(`/apply/status?ref=${encodeURIComponent(trimmed)}`)
  }

  const displayName = data
    ? [data.salutation, data.first_name, data.middle_name, data.last_name]
        .filter(Boolean)
        .join(" ") || data.name
    : ""

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <FileSearch className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Track Application</h2>
            <p className="text-muted-foreground text-sm">
              Check the status of your membership application using your reference number
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Enter reference number (e.g. AMASI-2026-12345)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={isLoading || !query.trim()}>
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Checking...
            </>
          ) : (
            "Check Status"
          )}
        </Button>
      </form>

      {error && searchRef && (
        <Card className="border-dashed">
          <CardContent className="pt-8 pb-8 text-center space-y-3">
            <div className="mx-auto w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <FileSearch className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="font-medium text-foreground">{error}</p>
            <p className="text-sm text-muted-foreground">
              Please verify the reference number and try again.
            </p>
          </CardContent>
        </Card>
      )}

      {data && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">{displayName}</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Ref: {data.reference_number}
                </p>
              </div>
              <Badge variant={statusBadgeVariant(data.status)}>
                {statusLabel(data.status)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Approved: show AMASI number prominently */}
            {(data.status === "approved" || data.status === "ai_approved") &&
              data.assigned_amasi_number && (
                <div className="bg-success/10 border border-success/20 rounded-xl p-8 text-center">
                  <div className="mx-auto w-14 h-14 rounded-full bg-success/15 flex items-center justify-center mb-3">
                    <Award className="h-7 w-7 text-success" />
                  </div>
                  <p className="text-sm text-muted-foreground mb-2">
                    Your AMASI Membership Number
                  </p>
                  <p className="text-4xl font-bold font-mono text-success tracking-wider">
                    {data.assigned_amasi_number}
                  </p>
                  <p className="text-xs text-muted-foreground mt-3">
                    Use this number to access your membership card and certificate
                  </p>
                </div>
              )}

            {/* Details grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Reference Number</span>
                <p className="font-medium font-mono">
                  {data.reference_number}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Membership Type</span>
                <p className="font-medium">
                  {membershipTypeLabel(data.membership_type)}
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">
                  Application Status
                </span>
                <p className="font-medium">{statusLabel(data.status)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Payment Status</span>
                <p className="font-medium">
                  <Badge
                    variant={
                      data.payment_status === "paid" ? "success" : "warning"
                    }
                    className="text-xs"
                  >
                    {paymentLabel(data.payment_status)}
                  </Badge>
                </p>
              </div>
              <div className="space-y-1">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Submitted</span>
                <p className="font-medium">{formatDate(data.created_at)}</p>
              </div>
              {data.reviewed_at && (
                <div className="space-y-1">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Reviewed</span>
                  <p className="font-medium">{formatDate(data.reviewed_at)}</p>
                </div>
              )}
            </div>

            {/* Review notes */}
            {data.review_notes && (
              <div className="border-t pt-4">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Review Notes
                </h4>
                <p className="text-sm">{data.review_notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function StatusPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-2xl mx-auto py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-muted-foreground mt-4">Loading...</p>
        </div>
      }
    >
      <StatusContent />
    </Suspense>
  )
}
