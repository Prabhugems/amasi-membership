"use client"

import { useState, useMemo, useEffect, useCallback, useRef } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
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
  Send,
  Truck,
  Link2,
  Check,
  StickyNote,
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
  dispatch_status: string | null
  tracking_number: string | null
  dispatched_at: string | null
  notes: string | null
}

interface OtherCredential {
  credential_type: "FMAS" | "MMAS" | "DIPMAS" | "COURSE_CERT"
  year: number
  skill_course_id: number | null
  course_name: string | null
  course_place: string | null
  awarded_at: string | null
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
  const cardTones = {
    default: "bg-card",
    amber: "bg-gradient-to-br from-amber-50/80 to-white dark:from-amber-500/10 dark:to-slate-950 border-amber-200/60 dark:border-amber-400/20",
    emerald: "bg-gradient-to-br from-emerald-50/80 to-white dark:from-emerald-500/10 dark:to-slate-950 border-emerald-200/60 dark:border-emerald-400/20",
    blue: "bg-gradient-to-br from-blue-50/80 to-white dark:from-blue-500/10 dark:to-slate-950 border-blue-200/60 dark:border-blue-400/20",
  }
  const badgeTones = {
    default: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300 ring-slate-200/60 dark:ring-slate-700/60",
    amber: "bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700 dark:from-amber-500/30 dark:to-amber-700/20 dark:text-amber-300 ring-amber-300/60 dark:ring-amber-400/30",
    emerald: "bg-gradient-to-br from-emerald-100 to-emerald-200 text-emerald-700 dark:from-emerald-500/30 dark:to-emerald-700/20 dark:text-emerald-300 ring-emerald-300/60 dark:ring-emerald-400/30",
    blue: "bg-gradient-to-br from-blue-100 to-blue-200 text-blue-700 dark:from-blue-500/30 dark:to-blue-700/20 dark:text-blue-300 ring-blue-300/60 dark:ring-blue-400/30",
  }
  return (
    <div className={`relative overflow-hidden border rounded-2xl p-5 card-lift ${cardTones[tone]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
            {label}
          </div>
          <div className="mt-2 text-3xl font-bold tracking-tight tabular-nums leading-none">
            {value}
          </div>
          {hint && (
            <div className="text-xs text-muted-foreground mt-2 truncate">{hint}</div>
          )}
        </div>
        <div className={`h-9 w-9 rounded-xl ring-1 flex items-center justify-center shrink-0 ${badgeTones[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
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

function courseBadgeTone(year: number): string {
  // Year-cohort coloring: recent rounds are warm/amber, older are cooler.
  if (year >= 2024) return "from-amber-100 to-amber-50 text-amber-800 ring-amber-300/60 dark:from-amber-500/25 dark:to-amber-700/10 dark:text-amber-200 dark:ring-amber-400/30"
  if (year >= 2020) return "from-blue-100 to-blue-50 text-blue-800 ring-blue-300/60 dark:from-blue-500/25 dark:to-blue-700/10 dark:text-blue-200 dark:ring-blue-400/30"
  if (year >= 2015) return "from-emerald-100 to-emerald-50 text-emerald-800 ring-emerald-300/60 dark:from-emerald-500/25 dark:to-emerald-700/10 dark:text-emerald-200 dark:ring-emerald-400/30"
  return "from-slate-100 to-slate-50 text-slate-700 ring-slate-300/60 dark:from-slate-700/30 dark:to-slate-800/10 dark:text-slate-200 dark:ring-slate-600/40"
}

function CourseBadge({ row }: { row: FmasRow }) {
  if (row.skill_course_id === null) {
    return <span className="text-muted-foreground text-xs">—</span>
  }
  const tone = courseBadgeTone(row.year)
  return (
    <div className="inline-flex items-center gap-2 min-w-0">
      <span
        className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gradient-to-br ring-1 ${tone}`}
      >
        <Hash className="h-2.5 w-2.5 opacity-70" />
        {row.skill_course_id}
      </span>
      {row.course_name && (
        <span className="text-xs text-muted-foreground hidden xl:inline truncate max-w-[180px]">
          {row.course_name.replace(/^\d+\s+FMAS Course\s+/i, "")}
        </span>
      )}
    </div>
  )
}

const DISPATCH_OPTIONS = [
  { value: "", label: "Not set" },
  { value: "pending", label: "Pending" },
  { value: "shipped", label: "Shipped" },
  { value: "delivered", label: "Delivered" },
  { value: "rto", label: "RTO" },
  { value: "n/a", label: "N/A" },
] as const

function dispatchTone(s: string | null): string {
  switch (s) {
    case "delivered":
      return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-400/30"
    case "shipped":
      return "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-400/30"
    case "pending":
      return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-400/30"
    case "rto":
      return "bg-red-50 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-400/30"
    case "n/a":
      return "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700"
    default:
      return "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700"
  }
}

function DetailSheet({
  row,
  onClose,
}: {
  // Parent gates rendering with a key={amasi-year}; this component owns its
  // form state from mount and is remounted when the selected row changes.
  row: FmasRow
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [dispatchStatus, setDispatchStatus] = useState<string>(row.dispatch_status ?? "")
  const [trackingNumber, setTrackingNumber] = useState<string>(row.tracking_number ?? "")
  const [notes, setNotes] = useState<string>(row.notes ?? "")
  const [verifyExpiry, setVerifyExpiry] = useState<"7d" | "30d" | "90d" | "1y">("30d")
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const otherCreds = useQuery<{ credentials: OtherCredential[] }>({
    queryKey: ["admin-credentials", row.amasi_number],
    queryFn: async () => {
      const res = await fetch(`/api/admin/credentials/${row.amasi_number}`)
      if (!res.ok) throw new Error(await res.text())
      return res.json()
    },
  })

  const emailCert = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/fmas/email-cert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amasi_number: row.amasi_number }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Failed to send")
      return json
    },
    onSuccess: (json: { sent_to: string }) => {
      toast.success(`Certificate sent to ${json.sent_to}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const saveDispatch = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/fmas/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amasi_number: row.amasi_number,
          year: row!.year,
          dispatch_status: dispatchStatus || null,
          tracking_number: trackingNumber || null,
          notes: notes || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Failed to save")
      return json
    },
    onSuccess: () => {
      toast.success("Dispatch saved")
      qc.invalidateQueries({ queryKey: ["admin-fmas-list"] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const generateVerifyLink = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/fmas/verify-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amasi_number: row.amasi_number,
          expiresIn: verifyExpiry,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Failed to generate link")
      return json
    },
    onSuccess: (json: { url: string }) => {
      setVerifyUrl(json.url)
      copyToClipboard(json.url, "Verify link")
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const place = placeOf(row)
  const conv = convocationNumber(row)
  const others = (otherCreds.data?.credentials ?? []).filter(
    (c) => !(c.credential_type === "FMAS" && c.year === row.year)
  )

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 z-50 h-full w-full sm:w-[480px] bg-white dark:bg-slate-950 shadow-2xl overflow-y-auto animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-label="FMAS holder details"
      >
        {/* Hero header — gradient cover, large avatar, AMASI seal */}
        <div className="relative overflow-hidden bg-gradient-to-br from-amber-500 via-amber-400 to-orange-400 dark:from-amber-700 dark:via-amber-800 dark:to-amber-950">
          <div
            aria-hidden="true"
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage:
                "radial-gradient(circle at 25% 30%, rgba(255,255,255,0.4) 0%, transparent 40%), radial-gradient(circle at 75% 70%, rgba(255,255,255,0.2) 0%, transparent 35%)",
            }}
          />
          <button
            onClick={onClose}
            className="absolute top-3 right-3 z-10 p-1.5 rounded-md bg-white/20 hover:bg-white/30 backdrop-blur text-white transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="relative px-5 pt-7 pb-5">
            <div className="flex items-end gap-4">
              {row.profile_photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={row.profile_photo}
                  alt={row.name ?? "Member"}
                  className="h-20 w-20 rounded-full object-cover ring-4 ring-white/80 shadow-xl shrink-0"
                />
              ) : (
                <div className="h-20 w-20 rounded-full bg-white/95 ring-4 ring-white/80 shadow-xl flex items-center justify-center text-amber-700 font-bold text-2xl shrink-0">
                  {(row.name ?? "?")
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((s) => s[0]?.toUpperCase())
                    .join("")}
                </div>
              )}
              <div className="min-w-0 pb-1">
                <h2 className="font-bold text-white text-lg leading-tight drop-shadow-sm truncate">
                  {row.name ?? "Unknown"}
                </h2>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[11px] font-mono text-white/90 bg-white/15 backdrop-blur px-1.5 py-0.5 rounded">
                    #{row.amasi_number}
                  </span>
                  {(row.city || row.state) && (
                    <span className="text-[11px] text-white/85 truncate">
                      {[row.city, row.state].filter(Boolean).join(", ")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {/* Credential card — designed to feel like a wallet pass */}
          <div className="relative overflow-hidden border-2 border-amber-200/80 dark:border-amber-400/30 rounded-2xl bg-gradient-to-br from-amber-50 via-white to-amber-50/40 dark:from-amber-500/15 dark:via-slate-950 dark:to-amber-500/5 shadow-sm">
            {/* Decorative corner */}
            <div
              aria-hidden="true"
              className="absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br from-amber-200/40 to-amber-400/10 blur-2xl"
            />
            <div className="relative p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] font-bold text-amber-800 dark:text-amber-300">
                  <span className="h-6 w-6 rounded-md bg-gradient-to-br from-amber-400 to-amber-600 shadow flex items-center justify-center">
                    <Award className="h-3 w-3 text-white" />
                  </span>
                  FMAS Credential
                </div>
                <span className="text-[10px] font-mono text-amber-700/80 dark:text-amber-400/70 bg-amber-100/60 dark:bg-amber-500/15 px-2 py-0.5 rounded-full border border-amber-200/60 dark:border-amber-400/20">
                  Verified
                </span>
              </div>
              <div className="space-y-1">
                {row.course_name ? (
                  <div className="font-bold text-base leading-snug">{row.course_name}</div>
                ) : row.skill_course_id !== null ? (
                  <div className="font-bold text-base">Course #{row.skill_course_id}</div>
                ) : (
                  <div className="text-muted-foreground italic">No course linked</div>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs pt-3 border-t border-amber-200/50 dark:border-amber-400/20">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Place
                  </div>
                  <div className="font-semibold mt-0.5">{place ?? "—"}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Year
                  </div>
                  <div className="font-semibold tabular-nums mt-0.5">{row.year}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Awarded
                  </div>
                  <div className="font-semibold mt-0.5">{formatDate(row.awarded_at)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                    Convocation #
                  </div>
                  <div className="font-semibold font-mono flex items-center gap-1 mt-0.5">
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
            <div className="px-4 pb-4 flex gap-2">
              <Button
                asChild
                size="sm"
                className="flex-1 gap-1.5 bg-gradient-to-br from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white border-0 shadow-md shadow-amber-500/30"
              >
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

          {/* Actions */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              Actions
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 justify-start"
                disabled={!row.email || emailCert.isPending}
                onClick={() => emailCert.mutate()}
                title={row.email ? `Send to ${row.email}` : "Member has no email on file"}
              >
                {emailCert.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                Email cert
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 justify-start"
                disabled={generateVerifyLink.isPending}
                onClick={() => generateVerifyLink.mutate()}
                title="Generate a public verification link"
              >
                {generateVerifyLink.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Link2 className="h-3.5 w-3.5" />
                )}
                Verify link
              </Button>
            </div>
            {verifyUrl && (
              <div className="mt-2 border rounded-lg p-2.5 bg-emerald-50/40 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-400/30 text-xs">
                <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 font-medium mb-1">
                  <Check className="h-3 w-3" />
                  Link copied — expires in {verifyExpiry}
                </div>
                <div className="flex items-center gap-1">
                  <code className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {verifyUrl}
                  </code>
                  <button
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => copyToClipboard(verifyUrl, "Verify link")}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Link expires in</span>
              <select
                value={verifyExpiry}
                onChange={(e) =>
                  setVerifyExpiry(e.target.value as "7d" | "30d" | "90d" | "1y")
                }
                className="h-7 border rounded px-1.5 bg-background"
              >
                <option value="7d">7 days</option>
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
                <option value="1y">1 year</option>
              </select>
            </div>
          </div>

          {/* Dispatch */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
              <Truck className="h-3 w-3" /> Dispatch
            </h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${dispatchTone(row.dispatch_status)}`}
                >
                  {row.dispatch_status ?? "Not set"}
                </span>
                {row.dispatched_at && (
                  <span className="text-xs text-muted-foreground">
                    {formatDate(row.dispatched_at)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={dispatchStatus}
                  onChange={(e) => setDispatchStatus(e.target.value)}
                  className="h-9 border rounded-md px-2 text-sm bg-background"
                >
                  {DISPATCH_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <Input
                  placeholder="Tracking #"
                  value={trackingNumber}
                  onChange={(e) => setTrackingNumber(e.target.value)}
                  className="h-9 text-sm"
                />
              </div>
              <div className="relative">
                <StickyNote className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <textarea
                  placeholder="Internal note (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  className="w-full pl-8 pr-2 py-2 text-sm border rounded-md bg-background resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
              <Button
                size="sm"
                className="w-full gap-1.5"
                disabled={saveDispatch.isPending}
                onClick={() => saveDispatch.mutate()}
              >
                {saveDispatch.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5" />
                )}
                Save dispatch
              </Button>
            </div>
          </div>

          {/* Other credentials */}
          <div>
            <h3 className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
              All credentials
            </h3>
            {otherCreds.isLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : others.length === 0 ? (
              <div className="text-xs text-muted-foreground italic">
                No other credentials on file.
              </div>
            ) : (
              <div className="space-y-1.5">
                {others.map((c) => (
                  <div
                    key={`${c.credential_type}-${c.year}`}
                    className="border rounded-lg px-3 py-2 text-sm flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-xs">
                        {c.credential_type} · {c.year}
                      </div>
                      {c.course_name && (
                        <div className="text-xs text-muted-foreground truncate">
                          {c.course_name}
                        </div>
                      )}
                    </div>
                    {c.course_place && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {c.course_place}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
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
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-amber-50/80 via-white to-white dark:from-amber-500/10 dark:via-slate-950 dark:to-slate-950 shadow-sm">
        <div
          aria-hidden="true"
          className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-gradient-to-br from-amber-200/50 to-amber-400/20 dark:from-amber-500/20 dark:to-amber-600/5 blur-3xl pointer-events-none"
        />
        <div
          aria-hidden="true"
          className="absolute -bottom-16 -left-16 h-64 w-64 rounded-full bg-gradient-to-br from-amber-100/40 to-orange-200/20 dark:from-amber-700/10 dark:to-orange-500/5 blur-3xl pointer-events-none"
        />
        <div className="relative p-6 md:p-7 flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 shadow-lg shadow-amber-500/30 dark:shadow-amber-500/20 flex items-center justify-center shrink-0 ring-1 ring-amber-300/50">
              <Award className="h-6 w-6 text-white" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-700 dark:text-amber-400 mb-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                Credential Console
              </div>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">FMAS Holders</h1>
              <p className="text-muted-foreground mt-1.5 text-sm">
                Foundations of Minimal Access Surgery
                <span className="hidden sm:inline">
                  {" · "}Press{" "}
                  <kbd className="px-1.5 py-0.5 rounded border bg-white/70 dark:bg-slate-900/70 text-[11px] font-mono">⌘K</kbd>{" "}
                  to search
                </span>
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={filtered.length === 0}
            className="gap-2 bg-white/70 dark:bg-slate-900/70 backdrop-blur"
          >
            <Download className="h-4 w-4" />
            Export CSV
            {filtered.length > 0 && (
              <Badge variant="outline" className="ml-1 tabular-nums bg-white/70 dark:bg-slate-900/70">
                {filtered.length.toLocaleString("en-IN")}
              </Badge>
            )}
          </Button>
        </div>
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
      <div className="border rounded-2xl bg-card shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-gradient-to-b from-muted/30 to-transparent">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-amber-600 transition-colors" />
            <Input
              ref={searchRef}
              placeholder="Search name, AMASI #, mobile, email, course #, place, convocation #…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
              className="pl-11 pr-20 h-12 text-sm md:text-base bg-background border-slate-200 dark:border-slate-800 focus-visible:ring-amber-500/30 focus-visible:border-amber-500/60 rounded-xl"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
              {q && (
                <button
                  onClick={() => {
                    setQ("")
                    setPage(1)
                  }}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {!q && (
                <kbd className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-muted/60 text-[10px] font-mono text-muted-foreground">
                  ⌘K
                </kbd>
              )}
            </div>
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
              <thead className="sticky top-0 z-10">
                <tr className="bg-gradient-to-b from-muted/80 to-muted/40 backdrop-blur border-b">
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
                    Dispatch
                  </th>
                  <th className="text-right px-4 py-3 font-semibold text-xs uppercase tracking-wider text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {pageRows.map((r, i) => (
                  <tr
                    key={`${r.amasi_number}-${r.year}-${r.skill_course_id ?? "x"}`}
                    className={`row-glow transition-colors group cursor-pointer ${
                      i % 2 === 1 ? "bg-muted/20" : ""
                    }`}
                    onClick={() => setSelected(r)}
                  >
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="ring-2 ring-transparent group-hover:ring-amber-200 dark:group-hover:ring-amber-400/30 rounded-full transition-all">
                          <Avatar name={r.name} src={r.profile_photo} />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold truncate">{r.name ?? "Unknown"}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {r.city ?? ""}
                            {r.city && r.state ? ", " : ""}
                            {r.state ?? ""}
                            {!r.city && !r.state && r.email && (
                              <span className="opacity-70">{r.email}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-xs">
                      <span className="text-foreground tabular-nums">{r.amasi_number}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <CourseBadge row={r} />
                    </td>
                    <td className="px-4 py-3.5 hidden md:table-cell text-sm">
                      {placeOf(r) ?? <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center justify-center min-w-[3rem] px-2 py-0.5 text-xs font-semibold tabular-nums rounded-md bg-muted text-foreground/80">
                        {r.year}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 hidden lg:table-cell text-xs text-muted-foreground">
                      {r.dispatch_status ? (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${dispatchTone(r.dispatch_status)}`}
                        >
                          {r.dispatch_status}
                        </span>
                      ) : (
                        <span className="opacity-50">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex justify-end gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
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

      {selected && (
        <DetailSheet
          key={`${selected.amasi_number}-${selected.year}`}
          row={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  )
}
