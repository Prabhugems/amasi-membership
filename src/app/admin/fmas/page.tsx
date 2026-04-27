"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Search,
  Loader2,
  Award,
  AlertTriangle,
  Download,
  X,
  MapPin,
  Calendar,
  Hash,
  Phone,
  Mail,
  ExternalLink,
  Copy,
  Filter,
  Users,
  Building2,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import Link from "next/link"

interface FmasRow {
  amasi_number: number
  name: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  profile_photo: string | null
  year: number
  awarded_at: string | null
  skill_course_id: number | null
  course_name: string | null
  course_place: string | null
  fallback_place: string | null
}

interface FmasApiResponse {
  rows: FmasRow[]
  stats: {
    total: number
    byYear: Array<{ year: number; count: number }>
    byPlace: Array<{ place: string; count: number }>
  }
  facets: {
    years: number[]
    places: string[]
    courses: Array<{ id: number; name: string; place: string | null }>
  }
  warnings: string[]
}

const PAGE_SIZE = 50

function placeOf(r: FmasRow): string | null {
  return r.course_place ?? r.fallback_place ?? null
}

function convocationNumber(r: FmasRow): string | null {
  // Convocation numbers in Airtable look like "114AEC1046": course id, "AEC",
  // and a sequential. We can't reconstruct the trailing sequential from
  // member_credentials alone, but we can show the prefix the admin can match.
  if (r.skill_course_id === null) return null
  return `${r.skill_course_id}AEC`
}

function rowMatchesQuery(r: FmasRow, needle: string): boolean {
  if (!needle) return true
  const q = needle.toLowerCase().trim()
  if (!q) return true
  if (String(r.amasi_number).includes(q)) return true
  if ((r.name ?? "").toLowerCase().includes(q)) return true
  if ((r.email ?? "").toLowerCase().includes(q)) return true
  if ((r.phone ?? "").toLowerCase().includes(q)) return true
  if ((r.city ?? "").toLowerCase().includes(q)) return true
  if ((r.state ?? "").toLowerCase().includes(q)) return true
  if ((r.course_name ?? "").toLowerCase().includes(q)) return true
  if ((r.course_place ?? "").toLowerCase().includes(q)) return true
  if (r.skill_course_id !== null && String(r.skill_course_id).includes(q)) return true
  // Convocation # match like "114AEC" or "114aec1046" (trailing digits ignored).
  const conv = convocationNumber(r)
  if (conv && q.replace(/\s+/g, "").toUpperCase().startsWith(conv)) return true
  return false
}

function formatDate(s: string | null): string {
  if (!s) return "—"
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function copyToClipboard(text: string, label: string) {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    toast.error("Clipboard unavailable")
    return
  }
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error("Copy failed")
  )
}

function buildCsv(rows: FmasRow[]): string {
  const head = [
    "AMASI Number",
    "Name",
    "Email",
    "Phone",
    "City",
    "State",
    "Course #",
    "Course Name",
    "Place",
    "Year",
    "Awarded",
  ]
  const escape = (v: string | number | null) => {
    if (v === null || v === undefined) return ""
    const s = String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const lines = [head.join(",")]
  for (const r of rows) {
    lines.push(
      [
        r.amasi_number,
        r.name,
        r.email,
        r.phone,
        r.city,
        r.state,
        r.skill_course_id,
        r.course_name,
        placeOf(r),
        r.year,
        r.awarded_at ? formatDate(r.awarded_at) : null,
      ]
        .map(escape)
        .join(",")
    )
  }
  return lines.join("\n")
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  tone = "default",
}: {
  icon: typeof Award
  label: string
  value: string | number
  hint?: string
  tone?: "default" | "amber" | "emerald" | "blue"
}) {
  const tones = {
    default: "bg-card",
    amber: "bg-amber-50/60 dark:bg-amber-500/10 border-amber-200/70 dark:border-amber-400/30",
    emerald: "bg-emerald-50/60 dark:bg-emerald-500/10 border-emerald-200/70 dark:border-emerald-400/30",
    blue: "bg-blue-50/60 dark:bg-blue-500/10 border-blue-200/70 dark:border-blue-400/30",
  }
  const iconTones = {
    default: "text-muted-foreground",
    amber: "text-amber-600 dark:text-amber-400",
    emerald: "text-emerald-600 dark:text-emerald-400",
    blue: "text-blue-600 dark:text-blue-400",
  }
  return (
    <div className={`border rounded-xl p-4 card-lift transition-shadow ${tones[tone]}`}>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground font-medium">
        <Icon className={`h-3.5 w-3.5 ${iconTones[tone]}`} />
        {label}
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  )
}

function Avatar({ name, src }: { name: string | null; src: string | null }) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("")
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={name ?? "Member"}
        className="h-9 w-9 rounded-full object-cover bg-muted shrink-0 border"
      />
    )
  }
  return (
    <div className="h-9 w-9 rounded-full bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-500/20 dark:to-amber-500/10 text-amber-800 dark:text-amber-200 flex items-center justify-center text-xs font-semibold shrink-0 border border-amber-200/50">
      {initials || "?"}
    </div>
  )
}

function CourseBadge({ row }: { row: FmasRow }) {
  if (row.skill_course_id === null) {
    return <span className="text-muted-foreground text-xs">—</span>
  }
  return (
    <div className="inline-flex items-center gap-2">
      <Badge
        variant="outline"
        className="font-mono bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:border-amber-400/30"
      >
        #{row.skill_course_id}
      </Badge>
      {row.course_name && (
        <span className="text-xs text-muted-foreground hidden xl:inline truncate max-w-[200px]">
          {row.course_name}
        </span>
      )}
    </div>
  )
}

function DetailSheet({
  row,
  open,
  onClose,
}: {
  row: FmasRow | null
  open: boolean
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open || !row) return null

  const place = placeOf(row)
  const conv = convocationNumber(row)

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 z-50 h-full w-full sm:w-[460px] bg-white dark:bg-slate-950 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-label="FMAS holder details"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b bg-white/95 dark:bg-slate-950/95 backdrop-blur px-5 py-4">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={row.name} src={row.profile_photo} />
            <div className="min-w-0">
              <h2 className="font-semibold truncate">{row.name ?? "Unknown"}</h2>
              <p className="text-xs text-muted-foreground font-mono">AMASI #{row.amasi_number}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md hover:bg-muted transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Credential card */}
          <div className="border rounded-xl p-4 bg-gradient-to-br from-amber-50 to-amber-50/30 dark:from-amber-500/10 dark:to-amber-500/5 border-amber-200/70 dark:border-amber-400/30">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-amber-800 dark:text-amber-300">
              <Award className="h-3.5 w-3.5" />
              FMAS Credential
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {row.course_name ? (
                <div className="font-semibold">{row.course_name}</div>
              ) : row.skill_course_id !== null ? (
                <div className="font-semibold">Course #{row.skill_course_id}</div>
              ) : (
                <div className="text-muted-foreground">No course linked</div>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Place</div>
                  <div className="font-medium">{place ?? "—"}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Year</div>
                  <div className="font-medium tabular-nums">{row.year}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Awarded</div>
                  <div className="font-medium">{formatDate(row.awarded_at)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Convocation #</div>
                  <div className="font-medium font-mono flex items-center gap-1">
                    {conv ? (
                      <>
                        <span>{conv}…</span>
                        <button
                          className="text-muted-foreground hover:text-foreground"
                          onClick={() => copyToClipboard(conv, "Course prefix")}
                          aria-label="Copy convocation prefix"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </>
                    ) : (
                      "—"
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button asChild size="sm" className="flex-1 gap-1.5">
                <Link href={`/member/fmas-certificate?id=${row.amasi_number}`} target="_blank">
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open certificate
                </Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => copyToClipboard(String(row.amasi_number), "AMASI #")}
                className="gap-1.5"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy #
              </Button>
            </div>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              Contact
            </h3>
            <div className="space-y-1.5 text-sm">
              {row.email && (
                <a
                  href={`mailto:${row.email}`}
                  className="flex items-center gap-2 hover:underline group"
                >
                  <Mail className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
                  <span className="truncate">{row.email}</span>
                </a>
              )}
              {row.phone && (
                <a
                  href={`tel:${row.phone}`}
                  className="flex items-center gap-2 hover:underline group"
                >
                  <Phone className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
                  <span>{row.phone}</span>
                </a>
              )}
              {(row.city || row.state) && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>{[row.city, row.state].filter(Boolean).join(", ")}</span>
                </div>
              )}
              {!row.email && !row.phone && !row.city && !row.state && (
                <div className="text-xs text-muted-foreground italic">No contact info</div>
              )}
            </div>
          </div>

          {/* Quick links */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              Links
            </h3>
            <div className="grid grid-cols-1 gap-1.5 text-sm">
              <Link
                href={`/member/fmas-certificate?id=${row.amasi_number}`}
                target="_blank"
                className="flex items-center justify-between px-3 py-2 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <span>FMAS certificate</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
              <Link
                href={`/api/credential?type=FMAS&id=${row.amasi_number}`}
                target="_blank"
                className="flex items-center justify-between px-3 py-2 rounded-lg border hover:bg-muted/50 transition-colors"
              >
                <span>Raw credential JSON</span>
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
              </Link>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}

export default function AdminFmasPage() {
  const [q, setQ] = useState("")
  const [year, setYear] = useState<string>("")
  const [place, setPlace] = useState<string>("")
  const [course, setCourse] = useState<string>("")
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<FmasRow | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const { data, isLoading, isError } = useQuery<FmasApiResponse>({
    queryKey: ["admin-fmas-list"],
    queryFn: async () => {
      const res = await fetch("/api/admin/fmas")
      if (!res.ok) throw new Error("Failed to load FMAS data")
      return res.json()
    },
  })

  // Cmd/Ctrl-K to focus search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  const filtered = useMemo(() => {
    const rows = data?.rows ?? []
    return rows.filter((r) => {
      if (!rowMatchesQuery(r, q)) return false
      if (year && String(r.year) !== year) return false
      if (place && placeOf(r) !== place) return false
      if (course && String(r.skill_course_id ?? "") !== course) return false
      return true
    })
  }, [data, q, year, place, course])

  const pageRows = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  )
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))

  const stats = data?.stats
  const facets = data?.facets
  const warnings = data?.warnings ?? []

  const topPlace = stats?.byPlace[0]
  const topYear = stats?.byYear[0]
  const yearsCovered = stats?.byYear.length ?? 0

  const handleExport = useCallback(() => {
    const csv = buildCsv(filtered)
    const stamp = new Date().toISOString().slice(0, 10)
    downloadCsv(`fmas-holders-${stamp}.csv`, csv)
    toast.success(`Exported ${filtered.length} rows`)
  }, [filtered])

  const resetFilters = useCallback(() => {
    setQ("")
    setYear("")
    setPlace("")
    setCourse("")
    setPage(1)
  }, [])

  const hasActiveFilters = q !== "" || year !== "" || place !== "" || course !== ""

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <span className="h-10 w-10 rounded-xl bg-amber-50 dark:bg-amber-500/15 border border-amber-200/70 dark:border-amber-400/30 flex items-center justify-center">
              <Award className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </span>
            FMAS Holders
          </h1>
          <p className="text-muted-foreground mt-1.5 text-sm">
            Verify a member&apos;s Foundations of Minimal Access Surgery credential.
            <span className="hidden sm:inline">
              {" "}
              Press <kbd className="px-1.5 py-0.5 rounded border bg-muted text-xs font-mono">⌘K</kbd> to search.
            </span>
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={filtered.length === 0}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          Export CSV
          {filtered.length > 0 && (
            <Badge variant="outline" className="ml-1 tabular-nums">
              {filtered.length}
            </Badge>
          )}
        </Button>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="border rounded-xl p-4 bg-amber-50/60 border-amber-200 dark:bg-amber-500/10 dark:border-amber-400/30 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
            {warnings.map((w, i) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat
          icon={Users}
          label="Total holders"
          value={stats ? stats.total.toLocaleString("en-IN") : "—"}
          tone="default"
        />
        <Stat
          icon={Calendar}
          label="Years covered"
          value={yearsCovered || "—"}
          hint={
            stats && stats.byYear.length > 0
              ? `${stats.byYear[stats.byYear.length - 1].year} – ${stats.byYear[0].year}`
              : undefined
          }
          tone="blue"
        />
        <Stat
          icon={Award}
          label="Latest year"
          value={topYear?.year ?? "—"}
          hint={topYear ? `${topYear.count.toLocaleString("en-IN")} holders` : undefined}
          tone="amber"
        />
        <Stat
          icon={Building2}
          label="Top place"
          value={topPlace?.place ?? "—"}
          hint={topPlace ? `${topPlace.count.toLocaleString("en-IN")} holders` : undefined}
          tone="emerald"
        />
      </div>

      {/* Search + filters */}
      <div className="border rounded-xl bg-card shadow-sm">
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchRef}
              placeholder="Search name, AMASI #, mobile, email, course #, place, convocation #…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              className="pl-9 pr-9 h-10"
            />
            {q && (
              <button
                onClick={() => {
                  setQ("")
                  setPage(1)
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        <div className="p-3 flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
            <Filter className="h-3.5 w-3.5" />
            Filter
          </div>
          <select
            value={year}
            onChange={(e) => {
              setYear(e.target.value)
              setPage(1)
            }}
            className="text-xs h-8 border rounded-md px-2 bg-background hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All years</option>
            {(facets?.years ?? []).map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
          <select
            value={place}
            onChange={(e) => {
              setPlace(e.target.value)
              setPage(1)
            }}
            className="text-xs h-8 border rounded-md px-2 bg-background hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All places</option>
            {(facets?.places ?? []).map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={course}
            onChange={(e) => {
              setCourse(e.target.value)
              setPage(1)
            }}
            className="text-xs h-8 border rounded-md px-2 bg-background hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="">All courses</option>
            {(facets?.courses ?? []).map((c) => (
              <option key={c.id} value={String(c.id)}>
                #{c.id} {c.place ? `· ${c.place}` : ""}
              </option>
            ))}
          </select>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-8 text-xs gap-1"
            >
              <X className="h-3 w-3" />
              Reset
            </Button>
          )}
          <div className="ml-auto text-xs text-muted-foreground tabular-nums">
            {isLoading
              ? "Loading…"
              : `Showing ${filtered.length.toLocaleString("en-IN")} of ${(stats?.total ?? 0).toLocaleString("en-IN")}`}
          </div>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="border rounded-xl p-16 text-center bg-card">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Loading FMAS holders…</p>
        </div>
      ) : isError ? (
        <div className="border rounded-xl p-12 text-center bg-card border-red-200 dark:border-red-400/30">
          <AlertTriangle className="h-8 w-8 mx-auto text-red-500" />
          <p className="font-semibold mt-2">Failed to load</p>
          <p className="text-sm text-muted-foreground mt-1">Try refreshing the page.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="border rounded-xl p-16 text-center bg-card">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3">
            <Search className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <p className="font-semibold">No matches</p>
          <p className="text-sm text-muted-foreground mt-1">
            {hasActiveFilters ? "Try adjusting search or filters." : "No FMAS holders yet."}
          </p>
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters} className="mt-4">
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden shadow-sm bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 border-b">
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Member
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    AMASI #
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Course
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                    Place
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Year
                  </th>
                  <th className="text-left px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden lg:table-cell">
                    Awarded
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pageRows.map((r) => (
                  <tr
                    key={`${r.amasi_number}-${r.year}-${r.skill_course_id ?? "x"}`}
                    className="row-glow hover:bg-primary/5 transition-colors group cursor-pointer"
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={r.name} src={r.profile_photo} />
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{r.name ?? "Unknown"}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {r.city ?? ""}
                            {r.city && r.state ? ", " : ""}
                            {r.state ?? ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Hash className="h-3 w-3" />
                        <span className="text-foreground">{r.amasi_number}</span>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <CourseBadge row={r} />
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">{placeOf(r) ?? "—"}</td>
                    <td className="px-4 py-3 tabular-nums">{r.year}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-xs text-muted-foreground">
                      {formatDate(r.awarded_at)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelected(r)
                          }}
                        >
                          Details
                        </Button>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Link
                            href={`/member/fmas-certificate?id=${r.amasi_number}`}
                            target="_blank"
                          >
                            <ExternalLink className="h-3 w-3" />
                            Cert
                          </Link>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
              <div className="text-xs text-muted-foreground tabular-nums">
                Page {page} of {totalPages.toLocaleString("en-IN")}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <DetailSheet row={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  )
}
