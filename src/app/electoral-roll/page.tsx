"use client"

import { Suspense, useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { Loader2, Search, ChevronLeft, ChevronRight, Info, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"

interface RollEntry {
  amasi_number: number
  name: string
  city: string | null
  state: string | null
  email_masked: string | null
  phone_masked: string | null
}

interface RollResponse {
  status: boolean
  data: RollEntry[]
  count: number
  page: number
  pageSize: number
  totalPages: number
  message?: string
}

const PAGE_SIZE = 50

function ElectoralRollContent() {
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState<RollEntry[]>([])
  const [count, setCount] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState("")

  // Debounce search input to avoid hammering the API on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  const fetchRoll = useCallback(async () => {
    setLoading(true)
    setErrorMessage("")
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
      })
      if (debouncedQuery) params.set("q", debouncedQuery)
      const res = await fetch(`/api/electoral-roll?${params.toString()}`)
      const json: RollResponse = await res.json()
      if (!json.status) {
        setErrorMessage(json.message || "Failed to load the roll. Please try again.")
        setRows([])
        setCount(0)
        setTotalPages(1)
        return
      }
      setRows(json.data)
      setCount(json.count)
      setTotalPages(json.totalPages)
    } catch {
      setErrorMessage("Unable to reach the server. Please check your connection and try again.")
    } finally {
      setLoading(false)
    }
  }, [page, debouncedQuery])

  useEffect(() => {
    void fetchRoll()
  }, [fetchRoll])

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        {/* Header */}
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Provisional Roll</p>
          <h1 className="text-3xl font-bold tracking-tight">Electoral Roll 2026</h1>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Provisional list of AMASI Life Members eligible to vote in the upcoming election.
            Contact details have been masked to protect member privacy. If any entry is incorrect,
            a member is missing, or you wish to be removed, please file an objection below.
          </p>
        </div>

        {/* Provisional notice */}
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
              <div className="text-sm text-amber-900 space-y-1">
                <p className="font-semibold">This is a provisional roll, not the final list.</p>
                <p>
                  Members may file objections until the close of the publication window. Each objection
                  is reviewed by the Election Officer and a corrected, final roll is published before
                  ballots are issued. Objections may also be sent by email to{" "}
                  <a className="underline underline-offset-2 font-medium" href="mailto:amasi.india@gmail.com">
                    amasi.india@gmail.com
                  </a>
                  .
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search + objection CTA */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search by name or AMASI number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9"
              aria-label="Search the electoral roll"
            />
          </div>
          <Link href="/electoral-roll/objection" className="shrink-0">
            <Button variant="outline" size="default" className="w-full sm:w-auto">
              File an objection
            </Button>
          </Link>
        </div>

        {/* Result count */}
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {loading
              ? "Loading…"
              : count === 0
                ? "No matching entries"
                : `${count.toLocaleString("en-IN")} eligible voter${count === 1 ? "" : "s"}`}
            {debouncedQuery && !loading && count > 0 && ` matching "${debouncedQuery}"`}
          </span>
          {totalPages > 1 && (
            <span>
              Page {page} of {totalPages}
            </span>
          )}
        </div>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {errorMessage ? (
              <div className="p-8 text-center text-sm text-destructive">{errorMessage}</div>
            ) : loading && rows.length === 0 ? (
              <div className="p-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
              </div>
            ) : rows.length === 0 ? (
              <div className="p-12 text-center space-y-3">
                <div className="mx-auto w-12 h-12 rounded-md bg-muted border border-border flex items-center justify-center">
                  <Info className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground">
                  No entries found{debouncedQuery ? ` for "${debouncedQuery}"` : ""}.
                </p>
                {debouncedQuery && (
                  <Button variant="ghost" size="sm" onClick={() => setQuery("")}>
                    Clear search
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40">
                    <tr className="text-left">
                      <th className="px-4 py-3 font-medium text-muted-foreground">AMASI #</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Name</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">City</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">State</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Email</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground">Mobile</th>
                      <th className="px-4 py-3 font-medium text-muted-foreground text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.amasi_number} className="border-t border-border hover:bg-muted/20">
                        <td className="px-4 py-3 font-mono text-foreground">{r.amasi_number}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{r.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.city || "—"}</td>
                        <td className="px-4 py-3 text-muted-foreground">{r.state || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.email_masked || "—"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{r.phone_masked || "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <Link href={`/electoral-roll/objection?ref=${r.amasi_number}`}>
                            <Button variant="ghost" size="sm">Object</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || loading}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Showing {((page - 1) * PAGE_SIZE + 1).toLocaleString("en-IN")}–
              {Math.min(page * PAGE_SIZE, count).toLocaleString("en-IN")} of{" "}
              {count.toLocaleString("en-IN")}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || loading}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}

        {/* Footer */}
        <div className="pt-6 border-t border-border text-xs text-muted-foreground space-y-1">
          <p>
            Email and mobile numbers are masked to comply with the Digital Personal Data Protection Act, 2023.
          </p>
          <p>
            For any clarification, write to{" "}
            <a className="underline underline-offset-2" href="mailto:amasi.india@gmail.com">
              amasi.india@gmail.com
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  )
}

export default function ElectoralRollPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }
    >
      <ElectoralRollContent />
    </Suspense>
  )
}
