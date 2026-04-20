"use client"

import { useState, useCallback, useRef, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Search, Download, ChevronLeft, ChevronRight, Users, LayoutGrid, List,
  ChevronUp, ChevronDown, ChevronsUpDown, X, Filter,
  MapPin, GraduationCap, Phone, Mail, CreditCard, Pencil, AlertCircle,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { getInitials } from "@/lib/utils"
import Link from "next/link"

const PAGE_SIZE = 50

const TYPE_FILTER_STYLES: Record<string, { active: string; inactive: string }> = {
  "": { active: "bg-gray-800 text-white border-gray-800", inactive: "bg-white text-gray-700 border-gray-200 hover:bg-gray-50" },
  LM: { active: "bg-emerald-600 text-white border-emerald-600", inactive: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100" },
  ALM: { active: "bg-blue-600 text-white border-blue-600", inactive: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100" },
  ACM: { active: "bg-purple-600 text-white border-purple-600", inactive: "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100" },
  ILM: { active: "bg-amber-600 text-white border-amber-600", inactive: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100" },
}

const TYPE_BADGE_STYLES: Record<string, string> = {
  LM: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  ALM: "bg-blue-50 text-blue-700 border border-blue-200",
  ACM: "bg-purple-50 text-purple-700 border border-purple-200",
  ILM: "bg-amber-50 text-amber-700 border border-amber-200",
}

const TYPE_FULL_NAMES: Record<string, string> = {
  LM: "Life Member",
  ALM: "Associate Life Member",
  ACM: "Associate Candidate Member",
  ILM: "International Life Member",
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  active: "bg-green-50 text-green-700 border border-green-200",
  inactive: "bg-red-50 text-red-700 border border-red-200",
  pending: "bg-yellow-50 text-yellow-700 border border-yellow-200",
}

const ZONES = ["North Zone", "South Zone", "East Zone", "West Zone", "Central Zone", "International"]
const STATUSES = ["active", "inactive"]

// Indian states commonly used
const STATES = [
  "Andhra Pradesh", "Assam", "Bihar", "Chhattisgarh", "Delhi", "Goa",
  "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim",
  "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal",
]

type SortDir = "asc" | "desc" | null
type SortCol = "name" | "amasi_number" | "membership_type" | "state" | "zone" | "status" | null
type ViewMode = "table" | "grid"

interface HoverState {
  member: any
  x: number
  y: number
}

function SortIcon({ col, activeCol, activeDir }: { col: string; activeCol: SortCol; activeDir: SortDir }) {
  if (activeCol !== col) return <ChevronsUpDown className="h-3.5 w-3.5 ml-1 text-muted-foreground/40" />
  if (activeDir === "asc") return <ChevronUp className="h-3.5 w-3.5 ml-1 text-primary" />
  return <ChevronDown className="h-3.5 w-3.5 ml-1 text-primary" />
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none text-sm border rounded-lg pl-3 pr-8 py-2 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary cursor-pointer transition-colors"
      >
        <option value="">{label}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
    </div>
  )
}

/* --- Hover preview popup --- */
function MemberPreview({ hover }: { hover: HoverState }) {
  const m = hover.member
  return (
    <div
      className="fixed z-50 pointer-events-none"
      style={{ left: hover.x + 16, top: hover.y - 10 }}
    >
      <div className="bg-white dark:bg-slate-900 border rounded-xl shadow-xl p-4 w-72 animate-in fade-in-0 zoom-in-95 duration-150">
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14 border shadow-sm shrink-0">
            {m.profile_photo && <AvatarImage src={m.profile_photo} alt={m.name || "Member photo"} />}
            <AvatarFallback className="text-sm font-semibold bg-primary/5 text-primary">
              {getInitials(m.name || "?")}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="font-bold text-sm">Dr. {m.name}</p>
            <p className="text-xs text-muted-foreground font-mono">#{m.amasi_number}</p>
            <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full mt-1 ${TYPE_BADGE_STYLES[m.membership_type] || "bg-muted text-muted-foreground"}`}>
              {TYPE_FULL_NAMES[m.membership_type] || m.membership_type}
            </span>
          </div>
        </div>
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {m.pg_degree && (
            <div className="flex items-center gap-2">
              <GraduationCap className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{m.pg_degree}</span>
            </div>
          )}
          {m.state && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>{m.state}{m.zone ? ` (${m.zone} Zone)` : ""}</span>
            </div>
          )}
          {m.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{m.email}</span>
            </div>
          )}
          {m.phone && (
            <div className="flex items-center gap-2">
              <Phone className="h-3.5 w-3.5 shrink-0" />
              <span>{m.phone}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* --- Grid card --- */
function MemberCard({ m }: { m: any }) {
  return (
    <div className="border rounded-xl p-4 bg-card hover:shadow-md transition-all group">
      <div className="flex items-start gap-3">
        <Avatar className="h-12 w-12 border shadow-sm shrink-0">
          {m.profile_photo && <AvatarImage src={m.profile_photo} alt={m.name || "Member photo"} />}
          <AvatarFallback className="text-xs font-semibold bg-primary/5 text-primary">
            {getInitials(m.name || "?")}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-sm truncate group-hover:text-primary transition-colors">
            Dr. {m.name}
          </p>
          <p className="text-xs text-muted-foreground font-mono">#{m.amasi_number}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full ${TYPE_BADGE_STYLES[m.membership_type] || "bg-muted text-muted-foreground"}`}>
          {m.membership_type}
        </span>
        {m.status && (
          <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE_STYLES[m.status] || "bg-muted text-muted-foreground"}`}>
            {m.status}
          </span>
        )}
      </div>
      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        {m.state && (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3 w-3" />
            <span className="truncate">{m.state}</span>
          </div>
        )}
        {m.pg_degree && (
          <div className="flex items-center gap-1.5">
            <GraduationCap className="h-3 w-3" />
            <span className="truncate">{m.pg_degree}</span>
          </div>
        )}
      </div>
      <div className="mt-3 pt-3 border-t flex gap-1.5">
        <Link href={`/card?id=${encodeURIComponent(m.email)}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full text-xs h-7">Card</Button>
        </Link>
        <Link href={`/profile?q=${encodeURIComponent(m.email)}`} className="flex-1">
          <Button variant="outline" size="sm" className="w-full text-xs h-7">Edit</Button>
        </Link>
      </div>
    </div>
  )
}

/* --- Skeleton rows --- */
function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="animate-pulse">
          <td className="px-4 py-3.5">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-muted" />
              <div className="space-y-2">
                <div className="h-4 w-32 bg-muted rounded" />
                <div className="h-3 w-48 bg-muted/60 rounded" />
              </div>
            </div>
          </td>
          <td className="px-4 py-3.5"><div className="h-6 w-12 bg-muted rounded-full" /></td>
          <td className="px-4 py-3.5 hidden md:table-cell"><div className="h-4 w-20 bg-muted rounded" /></td>
          <td className="px-4 py-3.5 hidden lg:table-cell"><div className="h-4 w-24 bg-muted rounded" /></td>
          <td className="px-4 py-3.5 hidden lg:table-cell"><div className="h-4 w-14 bg-muted rounded" /></td>
          <td className="px-4 py-3.5 hidden xl:table-cell"><div className="h-6 w-16 bg-muted rounded-full" /></td>
          <td className="px-4 py-3.5 hidden xl:table-cell"><div className="h-4 w-12 bg-muted rounded" /></td>
          <td className="px-4 py-3.5"><div className="h-7 w-16 bg-muted rounded ml-auto" /></td>
        </tr>
      ))}
    </>
  )
}

function GridSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="border rounded-xl p-4 animate-pulse">
          <div className="flex items-start gap-3">
            <div className="h-12 w-12 rounded-full bg-muted" />
            <div className="space-y-2 flex-1">
              <div className="h-4 w-28 bg-muted rounded" />
              <div className="h-3 w-16 bg-muted/60 rounded" />
            </div>
          </div>
          <div className="mt-3 flex gap-1.5">
            <div className="h-5 w-10 bg-muted rounded-full" />
            <div className="h-5 w-14 bg-muted rounded-full" />
          </div>
          <div className="mt-3 space-y-1.5">
            <div className="h-3 w-24 bg-muted/60 rounded" />
            <div className="h-3 w-20 bg-muted/60 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MembersPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [stateFilter, setStateFilter] = useState("")
  const [zoneFilter, setZoneFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [page, setPage] = useState(0)
  const [sortCol, setSortCol] = useState<SortCol>(null)
  const [sortDir, setSortDir] = useState<SortDir>(null)
  const [viewMode, setViewMode] = useState<ViewMode>("table")
  const [hover, setHover] = useState<HoverState | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeFilterCount = [typeFilter, stateFilter, zoneFilter, statusFilter].filter(Boolean).length

  const { data, isLoading, isError } = useQuery({
    queryKey: ["members-list", searchTerm, typeFilter, stateFilter, zoneFilter, statusFilter, page, sortCol, sortDir],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (searchTerm) params.set("q", searchTerm)
      if (typeFilter) params.set("type", typeFilter)
      if (stateFilter) params.set("state", stateFilter)
      if (zoneFilter) params.set("zone", zoneFilter)
      if (statusFilter) params.set("status", statusFilter)
      if (sortCol) params.set("sort", sortCol)
      if (sortDir) params.set("dir", sortDir)
      params.set("limit", String(PAGE_SIZE))
      params.set("offset", String(page * PAGE_SIZE))
      const res = await fetch(`/api/members/list?${params}`)
      return res.json()
    },
  })

  const members = data?.data || []
  const total = data?.total || 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(searchQuery)
    setPage(0)
  }

  const handleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === "asc") {
        setSortDir("desc")
      } else if (sortDir === "desc") {
        setSortCol(null)
        setSortDir(null)
      }
    } else {
      setSortCol(col)
      setSortDir("asc")
    }
    setPage(0)
  }, [sortCol, sortDir])

  const clearAllFilters = useCallback(() => {
    setTypeFilter("")
    setStateFilter("")
    setZoneFilter("")
    setStatusFilter("")
    setSearchTerm("")
    setSearchQuery("")
    setSortCol(null)
    setSortDir(null)
    setPage(0)
  }, [])

  const handleRowMouseEnter = useCallback((e: React.MouseEvent, member: any) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    hoverTimerRef.current = setTimeout(() => {
      setHover({ member, x: rect.right - 20, y: rect.top })
    }, 400)
  }, [])

  const handleRowMouseLeave = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    setHover(null)
  }, [])

  // Export CSV — calls server API which exports ALL filtered members (not just current page)
  const [exporting, setExporting] = useState(false)
  const exportCSV = useCallback(async () => {
    setExporting(true)
    try {
      const params = new URLSearchParams()
      if (searchTerm) params.set("q", searchTerm)
      if (typeFilter) params.set("type", typeFilter)
      if (stateFilter) params.set("state", stateFilter)
      if (zoneFilter) params.set("zone", zoneFilter)
      if (statusFilter) params.set("status", statusFilter)
      const res = await fetch(`/api/export/members?${params}`)
      if (!res.ok) throw new Error("Export failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `amasi-members-export-${new Date().toISOString().split("T")[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error("Export error:", err)
    } finally {
      setExporting(false)
    }
  }, [searchTerm, typeFilter, stateFilter, zoneFilter, statusFilter])

  const SortableHeader = ({ col, label, className }: { col: SortCol; label: string; className?: string }) => (
    <th
      className={`text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none transition-colors ${className || ""}`}
      onClick={() => handleSort(col)}
    >
      <span className="inline-flex items-center">
        {label}
        <SortIcon col={col!} activeCol={sortCol} activeDir={sortDir} />
      </span>
    </th>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">All Members</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            {isLoading ? (
              <span className="inline-block h-4 w-32 bg-muted rounded animate-pulse" />
            ) : (
              <>
                Showing{" "}
                <span className="font-medium text-foreground">{total > 0 ? page * PAGE_SIZE + 1 : 0}</span>
                {"\u2013"}
                <span className="font-medium text-foreground">{Math.min((page + 1) * PAGE_SIZE, total)}</span>
                {" "}of{" "}
                <span className="font-medium text-foreground">{total.toLocaleString()}</span>
                {" "}members
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex border rounded-lg overflow-hidden shadow-sm">
            <button
              onClick={() => setViewMode("table")}
              className={`p-2 transition-colors ${viewMode === "table" ? "bg-primary text-primary-foreground" : "bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 text-muted-foreground"}`}
              title="Table view"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 transition-colors ${viewMode === "grid" ? "bg-primary text-primary-foreground" : "bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 text-muted-foreground"}`}
              title="Grid view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>
          <Button variant="outline" size="sm" className="gap-2 shadow-sm" onClick={exportCSV} disabled={exporting}>
            <Download className="h-4 w-4" /> {exporting ? "Exporting..." : "Export All CSV"}
          </Button>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="space-y-3">
        <form onSubmit={handleSearch} className="flex gap-2 max-w-2xl">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, email, phone, or AMASI number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 h-11 shadow-sm"
            />
          </div>
          <Button type="submit" className="h-11 px-6">Search</Button>
          {searchTerm && (
            <Button variant="ghost" className="h-11" onClick={() => { setSearchTerm(""); setSearchQuery(""); setPage(0) }}>Clear</Button>
          )}
        </form>

        {/* Type filter pills */}
        <div className="flex gap-2 flex-wrap">
          {(["", "LM", "ALM", "ACM", "ILM"] as const).map((t) => {
            const styles = TYPE_FILTER_STYLES[t]
            const isActive = typeFilter === t
            return (
              <button
                key={t}
                onClick={() => { setTypeFilter(t); setPage(0) }}
                className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isActive ? styles.active : styles.inactive
                }`}
              >
                {t || "All Types"}
              </button>
            )
          })}
        </div>

        {/* Advanced filters row */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mr-1">
            <Filter className="h-3.5 w-3.5" />
            <span className="font-medium">Filters:</span>
          </div>
          <FilterSelect label="All States" value={stateFilter} onChange={(v) => { setStateFilter(v); setPage(0) }} options={STATES} />
          <FilterSelect label="All Zones" value={zoneFilter} onChange={(v) => { setZoneFilter(v); setPage(0) }} options={ZONES} />
          <FilterSelect label="All Statuses" value={statusFilter} onChange={(v) => { setStatusFilter(v); setPage(0) }} options={STATUSES} />
          {activeFilterCount > 0 && (
            <button
              onClick={clearAllFilters}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive px-2.5 py-2 rounded-lg hover:bg-destructive/5 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
              Clear all ({activeFilterCount + (searchTerm ? 1 : 0)})
            </button>
          )}
        </div>

        {/* Active filter tags */}
        {activeFilterCount > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {stateFilter && (
              <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 border border-blue-200 rounded-full px-2.5 py-1 font-medium">
                <MapPin className="h-3 w-3" /> {stateFilter}
                <button onClick={() => { setStateFilter(""); setPage(0) }} className="hover:text-blue-900"><X className="h-3 w-3" /></button>
              </span>
            )}
            {zoneFilter && (
              <span className="inline-flex items-center gap-1 text-xs bg-violet-50 text-violet-700 border border-violet-200 rounded-full px-2.5 py-1 font-medium">
                Zone: {zoneFilter}
                <button onClick={() => { setZoneFilter(""); setPage(0) }} className="hover:text-violet-900"><X className="h-3 w-3" /></button>
              </span>
            )}
            {statusFilter && (
              <span className="inline-flex items-center gap-1 text-xs bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-2.5 py-1 font-medium capitalize">
                Status: {statusFilter}
                <button onClick={() => { setStatusFilter(""); setPage(0) }} className="hover:text-orange-900"><X className="h-3 w-3" /></button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Error state */}
      {isError && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-3" />
          <p className="text-lg font-medium">Failed to load members</p>
          <p className="text-sm text-muted-foreground mt-1">Please try refreshing the page</p>
        </div>
      )}

      {/* Table View */}
      {!isError && viewMode === "table" && (
        <div className="border rounded-xl overflow-hidden shadow-sm bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 border-b">
                  <th className="text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground w-8">#</th>
                  <SortableHeader col="name" label="Member" />
                  <SortableHeader col="membership_type" label="Type" />
                  <SortableHeader col="state" label="State" className="hidden lg:table-cell" />
                  <SortableHeader col="zone" label="Zone" className="hidden lg:table-cell" />
                  <SortableHeader col="status" label="Status" className="hidden xl:table-cell" />
                  <th className="text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden md:table-cell">PG Degree</th>
                  <th className="text-right px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading && <TableSkeleton />}
                {!isLoading && members.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-16 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                          <Users className="h-7 w-7 text-muted-foreground/40" />
                        </div>
                        <div>
                          <p className="font-semibold text-foreground">No members found</p>
                          <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or filters</p>
                        </div>
                        {(searchTerm || activeFilterCount > 0) && (
                          <Button variant="outline" size="sm" onClick={clearAllFilters} className="mt-2">
                            Clear all filters
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {members.map((m: any, idx: number) => (
                  <tr
                    key={m.amasi_number}
                    className={`row-glow hover:bg-primary/5 transition-colors group cursor-default ${idx % 2 === 1 ? "bg-muted/20" : ""}`}
                    onMouseEnter={(e) => handleRowMouseEnter(e, m)}
                    onMouseLeave={handleRowMouseLeave}
                  >
                    <td className="px-4 py-3.5 text-xs text-muted-foreground font-mono">
                      {page * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border shadow-sm shrink-0">
                          {m.profile_photo && <AvatarImage src={m.profile_photo} alt={m.name || "Member photo"} />}
                          <AvatarFallback className="text-xs font-semibold bg-primary/5 text-primary">
                            {getInitials(m.name || "?")}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">Dr. {m.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            <span className="font-mono">#{m.amasi_number}</span>
                            {m.email && (
                              <>
                                <span className="mx-1.5 text-border">|</span>
                                <span className="hidden sm:inline">{m.email}</span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${TYPE_BADGE_STYLES[m.membership_type] || "bg-muted text-muted-foreground"}`}>
                        {m.membership_type}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell text-muted-foreground text-xs">{m.state || "\u2014"}</td>
                    <td className="px-4 py-3.5 hidden lg:table-cell text-muted-foreground text-xs">{m.zone || "\u2014"}</td>
                    <td className="px-4 py-3.5 hidden xl:table-cell">
                      {m.status ? (
                        <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATUS_BADGE_STYLES[m.status] || "bg-muted text-muted-foreground"}`}>
                          {m.status}
                        </span>
                      ) : "\u2014"}
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell text-muted-foreground text-xs truncate max-w-[160px]">{m.pg_degree || "\u2014"}</td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link href={`/card?id=${encodeURIComponent(m.email)}`}>
                          <Button variant="outline" size="sm" className="text-xs h-7 px-2.5 shadow-sm gap-1">
                            <CreditCard className="h-3 w-3" /> Card
                          </Button>
                        </Link>
                        <Link href={`/profile?q=${encodeURIComponent(m.email)}`}>
                          <Button variant="outline" size="sm" className="text-xs h-7 px-2.5 shadow-sm gap-1">
                            <Pencil className="h-3 w-3" /> Edit
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Grid View */}
      {!isError && viewMode === "grid" && (
        <>
          {isLoading ? (
            <GridSkeleton />
          ) : members.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16">
              <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
                <Users className="h-7 w-7 text-muted-foreground/40" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-foreground">No members found</p>
                <p className="text-sm text-muted-foreground mt-1">Try adjusting your search or filters</p>
              </div>
              {(searchTerm || activeFilterCount > 0) && (
                <Button variant="outline" size="sm" onClick={clearAllFilters} className="mt-2">
                  Clear all filters
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {members.map((m: any) => (
                <MemberCard key={m.amasi_number} m={m} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Hover Preview */}
      {hover && <MemberPreview hover={hover} />}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2 flex-wrap gap-4">
          <p className="text-sm text-muted-foreground">
            Showing <span className="font-medium text-foreground">{page * PAGE_SIZE + 1}</span>
            {"\u2013"}
            <span className="font-medium text-foreground">{Math.min((page + 1) * PAGE_SIZE, total)}</span>
            {" "}of{" "}
            <span className="font-medium text-foreground">{total.toLocaleString()}</span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage(0); window.scrollTo({ top: 0, behavior: "smooth" }) }}
              disabled={page === 0}
              className="h-9 px-3 shadow-sm hidden sm:flex"
            >
              First
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage(p => p - 1); window.scrollTo({ top: 0, behavior: "smooth" }) }}
              disabled={page === 0}
              className="h-9 px-3 shadow-sm"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <div className="flex items-center gap-1 mx-2">
              <span className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground">
                {page + 1}
              </span>
              <span className="text-sm text-muted-foreground">of {totalPages.toLocaleString()}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage(p => p + 1); window.scrollTo({ top: 0, behavior: "smooth" }) }}
              disabled={page >= totalPages - 1}
              className="h-9 px-3 shadow-sm"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setPage(totalPages - 1); window.scrollTo({ top: 0, behavior: "smooth" }) }}
              disabled={page >= totalPages - 1}
              className="h-9 px-3 shadow-sm hidden sm:flex"
            >
              Last
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
