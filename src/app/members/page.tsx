"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Download, ChevronLeft, ChevronRight, Users } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
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

export default function MembersPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [page, setPage] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ["members-list", searchTerm, typeFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams()
      if (searchTerm) params.set("q", searchTerm)
      if (typeFilter) params.set("type", typeFilter)
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">All Members</h2>
          <p className="text-muted-foreground mt-1 flex items-center gap-1.5">
            <Users className="h-4 w-4" />
            {total.toLocaleString()} members
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2 shadow-sm">
          <Download className="h-4 w-4" /> Export
        </Button>
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
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden shadow-sm bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/60 border-b">
              <th className="text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Member</th>
              <th className="text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden md:table-cell">PG Degree</th>
              <th className="text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden lg:table-cell">State</th>
              <th className="text-left px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Joined</th>
              <th className="text-right px-4 py-3.5 font-semibold text-xs uppercase tracking-wider text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">Loading members...</td></tr>
            )}
            {!isLoading && members.length === 0 && (
              <tr><td colSpan={6} className="p-12 text-center text-muted-foreground">No members found</td></tr>
            )}
            {members.map((m: any) => (
              <tr key={m.amasi_number} className="hover:bg-muted/40 transition-colors group">
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10 border shadow-sm">
                      {m.profile_photo && <AvatarImage src={m.profile_photo} />}
                      <AvatarFallback className="text-xs font-semibold bg-primary/5 text-primary">
                        {getInitials(m.name || "?")}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-sm group-hover:text-primary transition-colors">Dr. {m.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-mono">#{m.amasi_number}</span>
                        <span className="mx-1.5 text-border">|</span>
                        {m.email}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3.5">
                  <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-1 rounded-full ${TYPE_BADGE_STYLES[m.membership_type] || "bg-muted text-muted-foreground"}`}>
                    {m.membership_type}
                  </span>
                </td>
                <td className="px-4 py-3.5 hidden md:table-cell text-muted-foreground">{m.pg_degree || "\u2014"}</td>
                <td className="px-4 py-3.5 hidden lg:table-cell text-muted-foreground">{m.state || "\u2014"}</td>
                <td className="px-4 py-3.5 hidden lg:table-cell text-muted-foreground">{m.joining_date ? new Date(m.joining_date).getFullYear() : "\u2014"}</td>
                <td className="px-4 py-3.5 text-right">
                  <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Link href={`/card?id=${encodeURIComponent(m.email)}`}>
                      <Button variant="outline" size="sm" className="text-xs h-8 shadow-sm">Card</Button>
                    </Link>
                    <Link href={`/profile?q=${encodeURIComponent(m.email)}&admin=1`}>
                      <Button variant="outline" size="sm" className="text-xs h-8 shadow-sm">Edit</Button>
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
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
              onClick={() => setPage(p => p - 1)}
              disabled={page === 0}
              className="h-9 px-3 shadow-sm"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </Button>
            <div className="flex items-center gap-1 mx-2">
              <span className="text-sm font-medium px-3 py-1.5 rounded-md bg-primary text-primary-foreground">
                {page + 1}
              </span>
              <span className="text-sm text-muted-foreground">of {totalPages}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => p + 1)}
              disabled={page >= totalPages - 1}
              className="h-9 px-3 shadow-sm"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
