"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Loader2, Award } from "lucide-react"
import { Input } from "@/components/ui/input"
import Link from "next/link"

interface FmasRow {
  amasi_number: number
  name: string | null
  year: number
  skill_course_id: number | null
  convocation_place: string | null
}

export default function AdminFmasPage() {
  const [q, setQ] = useState("")

  const { data, isLoading } = useQuery<{ rows: FmasRow[] }>({
    queryKey: ["admin-fmas-list"],
    queryFn: async () => {
      const res = await fetch("/api/admin/fmas")
      return res.json()
    },
  })

  const filtered = useMemo(() => {
    const rows = data?.rows ?? []
    if (!q) return rows
    const needle = q.toLowerCase()
    return rows.filter(
      (r) =>
        String(r.amasi_number).includes(needle) ||
        (r.name ?? "").toLowerCase().includes(needle)
    )
  }, [data, q])

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Award className="h-6 w-6 text-amber-600" />
        <h1 className="text-2xl font-bold">FMAS Holders</h1>
        <span className="text-sm text-muted-foreground">
          {data ? `${data.rows.length} total` : "..."}
        </span>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or AMASI #"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="py-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
        </div>
      ) : (
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">AMASI #</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-4 py-2 font-medium">Skill Course #</th>
                <th className="px-4 py-2 font-medium">Convocation</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={`${r.amasi_number}-${r.year}`} className="border-t">
                  <td className="px-4 py-2 font-mono">{r.amasi_number}</td>
                  <td className="px-4 py-2">{r.name ?? "—"}</td>
                  <td className="px-4 py-2">{r.year}</td>
                  <td className="px-4 py-2">{r.skill_course_id ?? "—"}</td>
                  <td className="px-4 py-2">{r.convocation_place ?? "—"}</td>
                  <td className="px-4 py-2">
                    <Link
                      className="text-primary hover:underline"
                      href={`/member/fmas-certificate?id=${r.amasi_number}`}
                      target="_blank"
                    >
                      View cert
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                    No matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
