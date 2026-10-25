"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, Download, Loader2, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { toast } from "sonner"
import { SURVEY_NAMES, hasAllDetails, type SurveyAdminRow } from "@/lib/survey"

type SurveyFilter = "" | "DLC" | "PVH"
type StatusFilter = "" | "with" | "without"

const SURVEY_TABS: { key: SurveyFilter; label: string }[] = [
  { key: "", label: "Both surveys" },
  { key: "DLC", label: "DLC" },
  { key: "PVH", label: "PVH" },
]

function formatDate(iso: string | null): string {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
}

/** /admin/survey — DLC and PVH survey participants for the manuscript, with and without details, and CSV export. */
export default function SurveyParticipantsPage() {
  const [survey, setSurvey] = useState<SurveyFilter>("")
  const [status, setStatus] = useState<StatusFilter>("")
  const [filter, setFilter] = useState("")
  const { data, isFetching, refetch } = useQuery({
    queryKey: ["admin-survey"],
    queryFn: async (): Promise<{ rows: SurveyAdminRow[] } | { unauthorized: true }> => {
      const res = await fetch("/api/admin/survey", { cache: "no-store" })
      if (res.status === 401 || res.status === 403) return { unauthorized: true }
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.error || "Failed to load survey participants")
        throw new Error(body?.error || `HTTP ${res.status}`)
      }
      return { rows: body.rows ?? [] }
    },
    retry: false,
  })
  const loading = isFetching
  const authorized = !(data && "unauthorized" in data)
  const rows = useMemo(() => (data && "rows" in data ? data.rows : []), [data])

  const inSurvey = useMemo(() => (survey ? rows.filter((r) => r.surveys.includes(survey)) : rows), [rows, survey])
  const counts = useMemo(() => {
    const withDetails = inSurvey.filter(hasAllDetails).length
    return {
      total: inSurvey.length,
      with: withDetails,
      without: inSurvey.length - withDetails,
      replied: inSurvey.filter((r) => r.submitted_at).length,
    }
  }, [inSurvey])

  const visible = useMemo(() => {
    let list = status ? inSurvey.filter((r) => hasAllDetails(r) === (status === "with")) : inSurvey
    const q = filter.trim().toLowerCase()
    if (q) list = list.filter((r) => [r.email, r.name, r.hospital, r.city].some((v) => v?.toLowerCase().includes(q)))
    return list
  }, [inSurvey, status, filter])

  const exportHref = useMemo(() => {
    const p = new URLSearchParams({ format: "csv" })
    if (survey) p.set("survey", survey)
    if (status) p.set("status", status)
    return `/api/admin/survey?${p}`
  }, [survey, status])

  if (!authorized) {
    return (
      <div className="flex flex-col items-center justify-center py-24">
        <div className="h-16 w-16 rounded-md bg-muted border flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold mb-2">Access denied</h2>
        <p className="text-muted-foreground">Admin session required.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wider text-muted-foreground">AMASI Survey Consortium</p>
        <h1 className="text-2xl font-bold tracking-tight mt-1">Survey participants</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          Participants of the {SURVEY_NAMES.DLC} and the {SURVEY_NAMES.PVH}, for the manuscript&apos;s participant list.
          &ldquo;With details&rdquo; means name, hospital and city are all filled, from our records or sent by the
          participant through their emailed link.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Survey">
        {SURVEY_TABS.map((t) => (
          <Button
            key={t.key || "both"}
            role="tab"
            aria-selected={survey === t.key}
            variant={survey === t.key ? "default" : "outline"}
            size="sm"
            onClick={() => setSurvey(t.key)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Participants" value={counts.total} active={status === ""} onClick={() => setStatus("")} />
        <StatCard label="With details" value={counts.with} active={status === "with"} onClick={() => setStatus("with")} />
        <StatCard label="Without details" value={counts.without} active={status === "without"} onClick={() => setStatus("without")} />
        <StatCard label="Replied via link" value={counts.replied} />
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="filter" className="text-xs font-medium text-muted-foreground block mb-1">
            Filter
          </label>
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="filter"
              placeholder="email, name, hospital, city"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={loading} className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </Button>
        <Button asChild className="gap-2">
          <a href={exportHref} download>
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </Button>
      </div>

      <div className="rounded-md border bg-card overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground mt-2">Loading participants…</p>
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center">
            <div className="h-12 w-12 rounded-md bg-muted border flex items-center justify-center mx-auto mb-3">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No participants match</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/60 border-b">
                  {["Status", "Name", "Hospital", "City", "Email", "Surveys", "Replied"].map((h) => (
                    <th key={h} scope="col" className="text-left px-4 py-3 font-medium text-xs uppercase tracking-wider text-muted-foreground">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((r) => {
                  const complete = hasAllDetails(r)
                  return (
                    <tr key={r.email} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="inline-flex items-center gap-2 text-xs">
                          <span className={`h-2 w-2 rounded-full ${complete ? "bg-success" : "bg-warning"}`} aria-hidden />
                          {complete ? "with details" : "without details"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{r.name || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3">{r.hospital || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3">{r.city || <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground break-all">{r.email}</td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">{r.surveys.join(" + ")}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">{formatDate(r.submitted_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, active, onClick }: { label: string; value: number; active?: boolean; onClick?: () => void }) {
  const body = (
    <>
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </>
  )
  if (!onClick) return <div className="rounded-md border bg-card p-4">{body}</div>
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border bg-card p-4 text-left transition-colors hover:bg-muted/30 ${active ? "border-primary" : ""}`}
    >
      {body}
    </button>
  )
}
