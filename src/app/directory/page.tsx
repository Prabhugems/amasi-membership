"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import {
  Search, Loader2, MapPin, GraduationCap, User, Users,
  ChevronLeft, ChevronRight, X, Mail, Phone, Info,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface DirectoryMember {
  name: string
  salutation: string
  amasi_number: number
  membership_type: string
  pg_degree: string
  city: string
  state: string
  zone: string
  profile_photo: string | null
  // Present only when the API recognised the caller as a logged-in active
  // member. Server-side gate; never returned for anonymous requests.
  email?: string | null
  mobile?: string | null
}

interface DirectoryResponse {
  status: boolean
  data: DirectoryMember[]
  count: number
  page: number
  limit: number
  totalPages: number
  message?: string
}

function membershipLabel(type: string): string {
  const mt = (type || "").toUpperCase()
  if (mt.includes("LM") && !mt.includes("ALM") && !mt.includes("ILM")) return "Life Member"
  if (mt.includes("ALM") || mt.includes("ASSOCIATE LIFE")) return "Associate Life Member"
  if (mt.includes("ACM") || mt.includes("CANDIDATE")) return "Associate Candidate Member"
  if (mt.includes("ILM") || mt.includes("INTERNATIONAL")) return "International Life Member"
  return type || "Member"
}

function membershipColor(type: string): string {
  const mt = (type || "").toUpperCase()
  if (mt.includes("LM") && !mt.includes("ALM") && !mt.includes("ILM")) return "bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 border-teal-300"
  if (mt.includes("ALM")) return "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-300"
  if (mt.includes("ACM")) return "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-300"
  if (mt.includes("ILM")) return "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300"
  return "bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-300"
}

const ZONES = ["North Zone", "South Zone", "East Zone", "West Zone", "Central Zone"]
const MEMBERSHIP_TYPES = [
  { value: "LM", label: "Life Member (LM)" },
  { value: "ALM", label: "Associate Life Member (ALM)" },
  { value: "ACM", label: "Associate Candidate Member (ACM)" },
  { value: "ILM", label: "International Life Member (ILM)" },
]

export default function DirectoryPage() {
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState("")
  const [zoneFilter, setZoneFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<DirectoryMember[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [searched, setSearched] = useState(false)
  const [states, setStates] = useState<string[]>([])
  const [rateLimited, setRateLimited] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  // True after a successful search when the response carried no email on any
  // row — i.e. the caller is not a logged-in active member. Used to render
  // the "log in to see contacts" banner.
  const showLoggedOutBanner =
    searched &&
    !bannerDismissed &&
    results.length > 0 &&
    results.every((m) => !m.email)

  const limit = 20

  // Fetch distinct states for the filter dropdown
  useEffect(() => {
    fetch("/api/directory?limit=1")
      .then((r) => r.json())
      .catch(() => null)
  }, [])

  const fetchResults = useCallback(async (p: number) => {
    setLoading(true)
    setRateLimited(false)
    try {
      const params = new URLSearchParams()
      if (query.trim()) params.set("q", query.trim())
      if (stateFilter) params.set("state", stateFilter)
      if (zoneFilter) params.set("zone", zoneFilter)
      if (typeFilter) params.set("type", typeFilter)
      params.set("page", String(p))
      params.set("limit", String(limit))

      const res = await fetch(`/api/directory?${params}`)
      if (res.status === 429) {
        setRateLimited(true)
        setResults([])
        setTotalCount(0)
        setTotalPages(0)
        return
      }
      const data: DirectoryResponse = await res.json()
      if (data.status) {
        setResults(data.data)
        setTotalCount(data.count)
        setTotalPages(data.totalPages)

        // Extract unique states from results for filter suggestions
        const newStates = data.data
          .map((m) => m.state)
          .filter(Boolean)
          .filter((s, i, a) => a.indexOf(s) === i)
        setStates((prev) => {
          const merged = [...new Set([...prev, ...newStates])].sort()
          return merged
        })
      } else {
        setResults([])
        setTotalCount(0)
        setTotalPages(0)
      }
    } catch {
      setResults([])
      setTotalCount(0)
      setTotalPages(0)
    } finally {
      setLoading(false)
      setSearched(true)
    }
  }, [query, stateFilter, zoneFilter, typeFilter])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    fetchResults(1)
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchResults(newPage)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const clearFilters = () => {
    setQuery("")
    setStateFilter("")
    setZoneFilter("")
    setTypeFilter("")
    setPage(1)
    setSearched(false)
    setResults([])
    setTotalCount(0)
    setTotalPages(0)
  }

  const hasActiveFilters = query || stateFilter || zoneFilter || typeFilter

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Users className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Member Directory</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Search and find AMASI members by name, city, speciality, zone, or membership type
        </p>
      </div>

      {/* Logged-out hint — shown only after a search when the response has
          no email on any row, which means the API treated the caller as
          anonymous. Logged-in active members never see this. */}
      {showLoggedOutBanner && (
        <div className="max-w-3xl mx-auto flex items-start gap-3 rounded-lg border border-blue-200/60 bg-blue-50/60 dark:border-blue-500/30 dark:bg-blue-500/10 px-4 py-3 text-sm">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-blue-600 dark:text-blue-300" />
          <div className="flex-1 min-w-0">
            <p className="text-blue-900 dark:text-blue-100">
              Logged-in AMASI members see contact details.{" "}
              <Link href="/member" className="font-semibold underline hover:no-underline">
                Member Login →
              </Link>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setBannerDismissed(true)}
            aria-label="Dismiss"
            className="p-1 -m-1 rounded text-blue-700/70 dark:text-blue-200/70 hover:text-blue-900 dark:hover:text-blue-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Search & Filters */}
      <form onSubmit={handleSearch} className="space-y-4 max-w-3xl mx-auto">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, city, or speciality..."
              className="pl-10 h-12 text-base"
            />
          </div>
          <Button type="submit" disabled={loading} className="h-12 px-6">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
          </Button>
        </div>

        {/* Filter row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            value={stateFilter}
            onChange={(e) => setStateFilter(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">All States</option>
            {states.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">All Zones</option>
            {ZONES.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <option value="">All Membership Types</option>
            {MEMBERSHIP_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {hasActiveFilters && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground">Active filters:</span>
            {query && (
              <Badge variant="secondary" className="text-xs gap-1">
                &quot;{query}&quot;
                <button type="button" onClick={() => setQuery("")}><X className="h-3 w-3" /></button>
              </Badge>
            )}
            {stateFilter && (
              <Badge variant="secondary" className="text-xs gap-1">
                {stateFilter}
                <button type="button" onClick={() => setStateFilter("")}><X className="h-3 w-3" /></button>
              </Badge>
            )}
            {zoneFilter && (
              <Badge variant="secondary" className="text-xs gap-1">
                {zoneFilter}
                <button type="button" onClick={() => setZoneFilter("")}><X className="h-3 w-3" /></button>
              </Badge>
            )}
            {typeFilter && (
              <Badge variant="secondary" className="text-xs gap-1">
                {membershipLabel(typeFilter)}
                <button type="button" onClick={() => setTypeFilter("")}><X className="h-3 w-3" /></button>
              </Badge>
            )}
            <button type="button" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground underline">
              Clear all
            </button>
          </div>
        )}
      </form>

      {/* Rate limit warning */}
      {rateLimited && (
        <Card className="max-w-3xl mx-auto">
          <CardContent className="p-6 text-center">
            <p className="font-semibold text-orange-600 dark:text-orange-400">Too many requests</p>
            <p className="text-sm text-muted-foreground mt-2">
              Please wait a few minutes before searching again.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Searching directory...</p>
        </div>
      )}

      {/* Results */}
      {!loading && searched && results.length > 0 && (
        <>
          <div className="flex items-center justify-between max-w-3xl mx-auto">
            <p className="text-sm text-muted-foreground">
              Showing {(page - 1) * limit + 1}–{Math.min(page * limit, totalCount)} of{" "}
              <span className="font-semibold text-foreground">{totalCount.toLocaleString()}</span> members
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {results.map((member) => (
              <Card key={member.amasi_number} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start gap-3">
                    {/* Avatar */}
                    <div className="w-11 h-11 rounded-full bg-teal-100 dark:bg-teal-500/20 flex items-center justify-center shrink-0">
                      {member.profile_photo ? (
                        <img
                          src={member.profile_photo}
                          alt=""
                          className="w-11 h-11 rounded-full object-cover"
                        />
                      ) : (
                        <User className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate">
                        {member.salutation} {member.name}
                      </p>
                      <p className="text-xs text-muted-foreground font-mono">
                        AMASI #{member.amasi_number}
                      </p>
                    </div>
                  </div>

                  {/* Membership badge */}
                  <Badge className={`text-[11px] px-2 py-0.5 ${membershipColor(member.membership_type)}`}>
                    {membershipLabel(member.membership_type)}
                  </Badge>

                  {/* Details */}
                  <div className="space-y-1.5">
                    {member.pg_degree && (
                      <div className="flex items-center gap-2 text-sm">
                        <GraduationCap className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">{member.pg_degree}</span>
                      </div>
                    )}
                    {(member.city || member.state) && (
                      <div className="flex items-center gap-2 text-sm">
                        <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="truncate">
                          {[member.city, member.state].filter(Boolean).join(", ")}
                        </span>
                      </div>
                    )}
                    {member.zone && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Users className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{member.zone}</span>
                      </div>
                    )}
                    {member.email && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        <a
                          href={`mailto:${member.email}`}
                          className="truncate hover:text-foreground hover:underline"
                        >
                          {member.email}
                        </a>
                      </div>
                    )}
                    {member.mobile && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        <a
                          href={`tel:${member.mobile.replace(/\s+/g, "")}`}
                          className="truncate hover:text-foreground hover:underline"
                        >
                          {member.mobile}
                        </a>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum: number
                  if (totalPages <= 5) {
                    pageNum = i + 1
                  } else if (page <= 3) {
                    pageNum = i + 1
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i
                  } else {
                    pageNum = page - 2 + i
                  }
                  return (
                    <Button
                      key={pageNum}
                      variant={pageNum === page ? "default" : "outline"}
                      size="sm"
                      className="w-9 h-9 p-0"
                      onClick={() => handlePageChange(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  )
                })}
              </div>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="gap-1"
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </>
      )}

      {/* No results */}
      {!loading && searched && results.length === 0 && !rateLimited && (
        <Card className="max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-semibold">No members found</p>
            <p className="text-sm text-muted-foreground mt-2">
              Try adjusting your search terms or filters.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Initial state */}
      {!searched && !loading && (
        <div className="text-center text-sm text-muted-foreground space-y-4 max-w-md mx-auto">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border bg-card">
              <Search className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs font-medium">By Name</p>
              <p className="text-[10px] text-muted-foreground mt-1">Search member names</p>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <MapPin className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs font-medium">By Location</p>
              <p className="text-[10px] text-muted-foreground mt-1">City, state, or zone</p>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <GraduationCap className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs font-medium">By Speciality</p>
              <p className="text-[10px] text-muted-foreground mt-1">PG degree / speciality</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
