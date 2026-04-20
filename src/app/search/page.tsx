"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Search, User, Mail, Phone, MapPin, GraduationCap, FileText,
  ExternalLink, Pencil, Loader2, Users, ClipboardCheck,
  BarChart3, Clock, ArrowRight, Lightbulb, Hash, Command,
  CreditCard, Award, Eye, SearchX, X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { formatDate, getInitials } from "@/lib/utils"
import type { MemberData } from "@/lib/api"

const TYPE_COLORS: Record<string, string> = {
  LM: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ALM: "bg-blue-50 text-blue-700 border-blue-200",
  ACM: "bg-purple-50 text-purple-700 border-purple-200",
  ILM: "bg-amber-50 text-amber-700 border-amber-200",
}

const TYPE_FULL_NAMES: Record<string, string> = {
  LM: "Life Member",
  ALM: "Associate Life Member",
  ACM: "Associate Candidate Member",
  ILM: "International Life Member",
}

// Reverse lookup: "Life Member" → "LM", etc.
const NAME_TO_TYPE_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_FULL_NAMES).map(([code, name]) => [name, code])
)

function getTypeCode(applicationName: string | undefined | null): string {
  if (!applicationName) return ""
  return NAME_TO_TYPE_CODE[applicationName] || applicationName
}

const RECENT_SEARCHES_KEY = "amasi-recent-searches"

interface RecentSearch {
  query: string
  name: string
  membershipNo?: string
  type?: string
  timestamp: number
}

function getRecentSearches(): RecentSearch[] {
  if (typeof window === "undefined") return []
  try {
    const stored = localStorage.getItem(RECENT_SEARCHES_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function saveRecentSearch(search: RecentSearch) {
  try {
    const existing = getRecentSearches()
    const filtered = existing.filter((s) => s.query !== search.query)
    const updated = [search, ...filtered].slice(0, 5)
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated))
  } catch {
    // ignore storage errors
  }
}

function clearRecentSearches() {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY)
  } catch {
    // ignore
  }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

/* --- Skeleton loader for result card --- */
function ResultSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-3 animate-pulse">
      <Card className="md:col-span-1 overflow-hidden">
        <div className="h-20 bg-muted" />
        <CardContent className="-mt-12 flex flex-col items-center text-center pb-6">
          <div className="h-24 w-24 rounded-full bg-muted border-4 border-background" />
          <div className="h-5 w-40 bg-muted rounded mt-4" />
          <div className="h-4 w-28 bg-muted rounded mt-3" />
          <div className="h-8 w-32 bg-muted rounded mt-3" />
          <div className="mt-6 space-y-3 w-full">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 bg-muted/50 rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="md:col-span-2">
        <CardHeader className="pb-4">
          <div className="h-5 w-32 bg-muted rounded" />
        </CardHeader>
        <CardContent>
          <div className="grid gap-8 sm:grid-cols-2">
            {[1, 2].map((col) => (
              <div key={col} className="space-y-4">
                <div className="h-5 w-24 bg-muted rounded" />
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-4 bg-muted/60 rounded" />
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* --- Autocomplete suggestion dropdown --- */
function SuggestionDropdown({
  suggestions,
  onSelect,
  visible,
}: {
  suggestions: (MemberData & Record<string, any>)[]
  onSelect: (member: MemberData & Record<string, any>) => void
  visible: boolean
}) {
  if (!visible || suggestions.length === 0) return null

  return (
    <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-xl z-50 overflow-hidden max-h-[360px] overflow-y-auto animate-in fade-in-0 slide-in-from-top-2 duration-150">
      <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/40 border-b">
        {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""}
      </div>
      {suggestions.map((m, i) => (
        <button
          key={i}
          onClick={() => onSelect(m)}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-primary/5 transition-colors border-b last:border-0"
        >
          <Avatar className="h-9 w-9 shrink-0">
            {m.profile_photo && <AvatarImage src={m.profile_photo} alt={m.first_name} />}
            <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
              {getInitials(`${m.first_name} ${m.last_name}`)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">
              {m.salutation} {m.first_name} {m.last_name}
            </p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {m.membership_no && <span className="font-mono">#{m.membership_no}</span>}
              {m.application_name && (
                <span className={`inline-flex items-center text-[10px] font-semibold px-1.5 py-0 rounded-full border ${TYPE_COLORS[getTypeCode(m.application_name)] || "bg-muted"}`}>
                  {getTypeCode(m.application_name)}
                </span>
              )}
              {m.state_name && <span>{m.state_name}</span>}
            </div>
          </div>
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
        </button>
      ))}
    </div>
  )
}

/* --- Rich result card for multiple results --- */
function ResultCard({
  member,
  onSelect,
}: {
  member: MemberData & Record<string, any>
  onSelect: (member: MemberData & Record<string, any>) => void
}) {
  const m = member
  const typeKey = getTypeCode(m.application_name)

  return (
    <div className="border rounded-xl overflow-hidden bg-card hover:shadow-md transition-all group">
      {/* Color accent bar */}
      <div className={`h-1 ${typeKey === "LM" ? "bg-emerald-500" : typeKey === "ALM" ? "bg-blue-500" : typeKey === "ACM" ? "bg-purple-500" : typeKey === "ILM" ? "bg-amber-500" : "bg-gray-300"}`} />
      <div className="p-4">
        {/* Top: avatar + basic info */}
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14 shrink-0 border shadow-sm">
            {m.profile_photo && <AvatarImage src={m.profile_photo} alt={m.first_name} />}
            <AvatarFallback className="text-sm font-bold bg-primary/10 text-primary">
              {getInitials(`${m.first_name} ${m.last_name}`)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-sm truncate group-hover:text-primary transition-colors">
              {m.salutation} {m.first_name} {m.last_name}
            </p>
            {m.membership_no && (
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                AMASI #{m.membership_no}
              </p>
            )}
            <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
              {m.application_name && (
                <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full border ${TYPE_COLORS[typeKey] || "bg-muted"}`}>
                  {m.application_name}
                </span>
              )}
              <Badge
                variant={m.status_name === "Membership Number Allotted" ? "success" : "warning"}
                className="text-[10px] px-2 py-0"
              >
                {m.status_name === "Membership Number Allotted" ? "Active" : m.status_name}
              </Badge>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          {m.state_name && (
            <div className="flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <span>{m.state_name}{m.zone ? ` (${m.zone} Zone)` : ""}</span>
            </div>
          )}
          {(m.edu_postgrad_degree || m.pg_degree) && (
            <div className="flex items-center gap-2">
              <GraduationCap className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <span className="truncate">{m.edu_postgrad_degree || m.pg_degree}</span>
            </div>
          )}
          {m.email && (
            <div className="flex items-center gap-2">
              <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
              <span className="truncate">{m.email}</span>
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="mt-3 pt-3 border-t grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onSelect(m)}
            className="flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg hover:bg-primary/5 text-primary transition-colors"
          >
            <Eye className="h-3.5 w-3.5" /> View Profile
          </button>
          <Link
            href={`/profile?q=${encodeURIComponent(m.email)}`}
            className="flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg hover:bg-primary/5 text-primary transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit Profile
          </Link>
          <Link
            href={`/card?id=${encodeURIComponent(m.email)}`}
            className="flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg hover:bg-primary/5 text-primary transition-colors"
          >
            <CreditCard className="h-3.5 w-3.5" /> View Card
          </Link>
          <Link
            href={`/certificate?id=${encodeURIComponent(m.membership_no || m.email)}`}
            className="flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-lg hover:bg-primary/5 text-primary transition-colors"
          >
            <Award className="h-3.5 w-3.5" /> Certificate
          </Link>
        </div>
      </div>
    </div>
  )
}

/* --- Multiple results list --- */
function ResultsList({
  results,
  onSelect,
}: {
  results: (MemberData & Record<string, any>)[]
  onSelect: (member: MemberData & Record<string, any>) => void
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{results.length}</span> members found
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {results.map((m, i) => (
          <ResultCard key={i} member={m} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

/* --- Empty state with illustration-style look --- */
function NoResultsState({ searchTerm }: { searchTerm: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-16 flex flex-col items-center text-center max-w-lg mx-auto">
        {/* Illustration-style icon cluster */}
        <div className="relative mb-6">
          <div className="h-24 w-24 rounded-full bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
            <SearchX className="h-12 w-12 text-muted-foreground/30" />
          </div>
          <div className="absolute -top-1 -right-1 h-8 w-8 rounded-full bg-orange-100 flex items-center justify-center border-2 border-white">
            <X className="h-4 w-4 text-orange-500" />
          </div>
          <div className="absolute -bottom-2 -left-2 h-6 w-6 rounded-full bg-blue-100 border-2 border-white" />
        </div>

        <h3 className="text-xl font-bold">No member found</h3>
        <p className="text-sm text-muted-foreground mt-2 max-w-sm">
          We could not find any results for &ldquo;<span className="font-medium text-foreground">{searchTerm}</span>&rdquo;
        </p>

        <div className="mt-6 w-full max-w-xs">
          <div className="text-left space-y-2.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Try these suggestions</p>
            {[
              { icon: Mail, text: "Search using email address instead" },
              { icon: Phone, text: "Enter the full 10-digit phone number" },
              { icon: Hash, text: "Use the AMASI membership number" },
              { icon: User, text: "Check for correct spelling of the name" },
            ].map((item) => (
              <div key={item.text} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <item.icon className="h-3.5 w-3.5" />
                </div>
                <span>{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* --- Empty state - before any search --- */
function EmptyState({ recentSearches, onQuickSearch, onClearRecent }: {
  recentSearches: RecentSearch[]
  onQuickSearch: (q: string) => void
  onClearRecent: () => void
}) {
  const quickLinks = [
    { label: "All Members", href: "/members", icon: Users, desc: "Browse full directory" },
    { label: "Pending Actions", href: "/pending", icon: ClipboardCheck, desc: "Review applications" },
    { label: "Reports", href: "/reports", icon: BarChart3, desc: "Analytics & exports" },
  ]

  const searchTips = [
    { icon: User, example: "Palanivelu", label: "Full or partial name" },
    { icon: Mail, example: "doctor@email.com", label: "Email address" },
    { icon: Phone, example: "9876543210", label: "10-digit phone number" },
    { icon: Hash, example: "1234", label: "AMASI membership number" },
  ]

  return (
    <div className="space-y-8">
      {/* Search tips */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="h-4 w-4 text-amber-500" />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Search tips</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {searchTips.map((tip) => (
            <button
              key={tip.label}
              onClick={() => onQuickSearch(tip.example)}
              className="flex items-start gap-3 rounded-xl border border-dashed p-4 text-left hover:bg-accent hover:border-primary/30 transition-all group"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted group-hover:bg-primary/10 transition-colors shrink-0">
                <tip.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div>
                <p className="text-sm font-medium">{tip.label}</p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{tip.example}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Recent searches */}
      {recentSearches.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Recently viewed</h3>
            </div>
            <button
              onClick={onClearRecent}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Clear all
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentSearches.map((search) => {
              const typeKey = getTypeCode(search.type)
              return (
                <button
                  key={search.query}
                  onClick={() => onQuickSearch(search.query)}
                  className="flex items-center gap-3 rounded-xl border p-4 text-left hover:bg-accent hover:border-primary/30 transition-all group shadow-sm"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">
                      {search.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {search.membershipNo && (
                        <span className="text-xs text-muted-foreground font-mono">
                          #{search.membershipNo}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/60">{timeAgo(search.timestamp)}</span>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Quick access</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {quickLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-4 rounded-xl border p-4 hover:bg-accent hover:border-primary/30 transition-all group shadow-sm"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors shrink-0">
                <link.icon className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold group-hover:text-primary transition-colors">{link.label}</p>
                <p className="text-xs text-muted-foreground">{link.desc}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}

/* --- Member profile card (single result) --- */
function MemberProfile({ member }: { member: MemberData & Record<string, any> }) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {/* Profile sidebar */}
      <Card className="md:col-span-1 overflow-hidden">
        <div className="h-20 bg-gradient-to-br from-primary/20 via-primary/10 to-transparent" />
        <CardContent className="-mt-12 flex flex-col items-center text-center pb-6">
          <Avatar className="h-24 w-24 border-4 border-background shadow-lg">
            {member.profile_photo && <AvatarImage src={member.profile_photo} alt={member.first_name} />}
            <AvatarFallback className="text-xl font-bold bg-primary/10 text-primary">
              {getInitials(`${member.first_name} ${member.last_name}`)}
            </AvatarFallback>
          </Avatar>
          <h3 className="text-lg font-bold mt-4">
            {member.salutation} {member.first_name} {member.middle_name} {member.last_name}
          </h3>

          <div className="flex items-center gap-2 mt-3 flex-wrap justify-center">
            <Badge variant={member.status_name === "Membership Number Allotted" ? "success" : "warning"}>
              {member.status_name}
            </Badge>
            {member.application_name && (
              <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full border ${TYPE_COLORS[getTypeCode(member.application_name)] || "bg-muted"}`}>
                {member.application_name}
              </span>
            )}
          </div>

          {member.membership_no && (
            <p className="mt-3 text-sm font-mono font-bold text-primary bg-primary/5 px-3 py-1.5 rounded-lg">
              AMASI #{member.membership_no}
            </p>
          )}

          {/* Quick action buttons */}
          <div className="mt-4 w-full space-y-2">
            <Link
              href={`/profile?q=${encodeURIComponent(member.email)}`}
              className="block w-full"
            >
              <Button variant="default" size="sm" className="w-full gap-2">
                <Pencil className="h-4 w-4" />
                Edit Profile
              </Button>
            </Link>
            <div className="grid grid-cols-2 gap-2">
              <Link href={`/card?id=${encodeURIComponent(member.email)}`}>
                <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs">
                  <CreditCard className="h-3.5 w-3.5" />
                  View Card
                </Button>
              </Link>
              <Link href={`/certificate?id=${encodeURIComponent(member.membership_no || member.email)}`}>
                <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs">
                  <Award className="h-3.5 w-3.5" />
                  Certificate
                </Button>
              </Link>
            </div>
          </div>

          <div className="mt-6 space-y-3 w-full text-sm">
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate text-left">{member.email}</span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50">
              <Phone className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>{member.mobile_code} {member.mobile}</span>
            </div>
            <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/50">
              <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-left">{member.city}, {member.state_name}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Details */}
      <Card className="md:col-span-2">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold">Member Details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-8 sm:grid-cols-2">
            {/* Personal Info */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-primary">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <User className="h-4 w-4" />
                </div>
                Personal Info
              </h3>
              <dl className="space-y-3 text-sm">
                {[
                  { label: "Membership No", value: member.membership_no, bold: true },
                  { label: "Application No", value: member.application_no, bold: true },
                  { label: "Type", value: member.application_name, bold: true },
                  { label: "DOB", value: formatDate(member.dob) },
                  { label: "Gender", value: member.gender },
                  { label: "Zone", value: member.zone },
                  { label: "MCI Number", value: member.mci_council_number, bold: true },
                  { label: "Joined", value: formatDate(member.joining_date) },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between items-center py-1 border-b border-dashed border-border/50 last:border-0">
                    <dt className="text-muted-foreground">{item.label}</dt>
                    <dd className={item.bold ? "font-semibold" : ""}>{item.value || "\u2014"}</dd>
                  </div>
                ))}
              </dl>
            </div>

            {/* Education */}
            <div className="space-y-4">
              <h3 className="font-semibold text-sm flex items-center gap-2 text-primary">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                  <GraduationCap className="h-4 w-4" />
                </div>
                Education
              </h3>
              <div className="space-y-4 text-sm">
                {member.ug_college ? (
                  <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Undergraduate</p>
                    <p className="font-medium">{member.edu_undergrad_degree || "MBBS"}</p>
                    <p className="text-muted-foreground">{member.ug_college}</p>
                    {(member.ug_university || member.ug_year) && (
                      <p className="text-xs text-muted-foreground">
                        {[member.ug_university, member.ug_year].filter(Boolean).join(" \u2014 ")}
                      </p>
                    )}
                  </div>
                ) : null}
                {member.pg_degree ? (
                  <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Postgraduate</p>
                    <p className="font-medium">{member.pg_degree}</p>
                    {(member.pg_college || member.pg_university) && (
                      <p className="text-muted-foreground">
                        {[member.pg_college, member.pg_university, member.pg_year].filter(Boolean).join(" \u2014 ")}
                      </p>
                    )}
                  </div>
                ) : null}
                {!member.ug_college && !member.pg_degree && (
                  <p className="text-muted-foreground italic py-4 text-center">No education data available</p>
                )}
                {member.edu_superspecialty_degree && (
                  <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Super Specialty</p>
                    <p className="font-medium">{member.edu_superspecialty_degree}</p>
                    <p className="text-muted-foreground">
                      {member.edu_superspecialty_college} ({member.edu_superspecialty_year})
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Documents */}
          <div className="mt-8 space-y-4">
            <h3 className="font-semibold text-sm flex items-center gap-2 text-primary">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                <FileText className="h-4 w-4" />
              </div>
              Documents
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "MCI Certificate", url: member.mci_certificate },
                { label: "PG Degree", url: member.pg_degree_certificate },
                { label: "MBBS Degree", url: member.mbbs_degree_certificate },
                { label: "ASI Certificate", url: member.asi_member_certificate },
                { label: "Active License", url: member.active_license },
                { label: "HOD Letter", url: member.letter_hod },
              ]
                .filter((doc) => doc.url)
                .map((doc) => (
                  <a
                    key={doc.label}
                    href={doc.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-xl border p-4 text-sm hover:bg-accent hover:border-primary/30 transition-all group shadow-sm"
                  >
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 group-hover:bg-primary/20 transition-colors">
                      <ExternalLink className="h-4 w-4 text-primary" />
                    </div>
                    <span className="font-medium">{doc.label}</span>
                  </a>
                ))}
              {[
                member.mci_certificate, member.pg_degree_certificate, member.mbbs_degree_certificate,
                member.asi_member_certificate, member.active_license, member.letter_hod,
              ].every((u) => !u) && (
                <p className="text-muted-foreground italic col-span-3 py-4 text-center">No documents uploaded</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

/* --- Main search content --- */
function SearchContent() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const [query, setQuery] = useState(initialQuery)
  const [searchTerm, setSearchTerm] = useState(initialQuery)
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [selectedMember, setSelectedMember] = useState<(MemberData & Record<string, any>) | null>(null)
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)

  // Load recent searches on mount
  useEffect(() => {
    setRecentSearches(getRecentSearches())
  }, [])

  // Debounce the query for instant search suggestions (300ms)
  useEffect(() => {
    if (!query.trim() || query.trim().length < 2) {
      setDebouncedQuery("")
      return
    }
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim())
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // Close suggestions on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [])

  // Keyboard shortcut: Cmd+K or / to focus search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === "/" && document.activeElement?.tagName !== "INPUT" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault()
        inputRef.current?.focus()
      }
      if (e.key === "Escape") {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [])

  // Autocomplete suggestions query (debounced)
  const { data: suggestionsData, isLoading: suggestionsLoading } = useQuery({
    queryKey: ["member-suggestions", debouncedQuery],
    queryFn: async () => {
      if (!debouncedQuery) return null
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(debouncedQuery)}`)
      return res.json()
    },
    enabled: !!debouncedQuery && showSuggestions,
  })

  const suggestions: (MemberData & Record<string, any>)[] = suggestionsData?.data || []

  // Main search query (triggered on submit)
  const { data, isLoading, error } = useQuery({
    queryKey: ["member-search", searchTerm],
    queryFn: async () => {
      if (!searchTerm) return null
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(searchTerm)}`)
      return res.json()
    },
    enabled: !!searchTerm,
  })

  // Save to recent searches when a single result is found
  useEffect(() => {
    if (data?.status && data.data?.length === 1) {
      const m = data.data[0]
      saveRecentSearch({
        query: searchTerm,
        name: `${m.salutation || "Dr."} ${m.first_name} ${m.last_name}`.trim(),
        membershipNo: m.membership_no ? String(m.membership_no) : undefined,
        type: m.application_name || undefined,
        timestamp: Date.now(),
      })
      setRecentSearches(getRecentSearches())
    }
  }, [data, searchTerm])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSelectedMember(null)
    setSearchTerm(query.trim())
    setShowSuggestions(false)
  }

  const handleQuickSearch = useCallback((q: string) => {
    setQuery(q)
    setSelectedMember(null)
    setSearchTerm(q)
    setShowSuggestions(false)
  }, [])

  const handleSelectMember = useCallback((member: MemberData & Record<string, any>) => {
    setSelectedMember(member)
    setShowSuggestions(false)
    saveRecentSearch({
      query: member.email || searchTerm,
      name: `${member.salutation || "Dr."} ${member.first_name} ${member.last_name}`.trim(),
      membershipNo: member.membership_no ? String(member.membership_no) : undefined,
      type: member.application_name || undefined,
      timestamp: Date.now(),
    })
    setRecentSearches(getRecentSearches())
  }, [searchTerm])

  const handleSuggestionSelect = useCallback((member: MemberData & Record<string, any>) => {
    setSelectedMember(member)
    setQuery(`${member.first_name} ${member.last_name}`.trim())
    setSearchTerm(member.email || `${member.first_name} ${member.last_name}`.trim())
    setShowSuggestions(false)
    saveRecentSearch({
      query: member.email || `${member.first_name} ${member.last_name}`.trim(),
      name: `${member.salutation || "Dr."} ${member.first_name} ${member.last_name}`.trim(),
      membershipNo: member.membership_no ? String(member.membership_no) : undefined,
      type: member.application_name || undefined,
      timestamp: Date.now(),
    })
    setRecentSearches(getRecentSearches())
  }, [])

  const handleClearRecent = useCallback(() => {
    clearRecentSearches()
    setRecentSearches([])
  }, [])

  const results: (MemberData & Record<string, any>)[] = data?.data || []
  const hasSearched = !!searchTerm && !isLoading
  const noResults = hasSearched && data && !data.status
  const multipleResults = hasSearched && data?.status && results.length > 1 && !selectedMember
  const singleResult = hasSearched && data?.status && (results.length === 1 || selectedMember)
  const member = selectedMember || (results.length === 1 ? results[0] : null)

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Search Member</h1>
        <p className="text-muted-foreground mt-1">
          Look up any member by name, email, phone, or AMASI number
        </p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch}>
        <div className="relative max-w-2xl" ref={suggestionsRef}>
          <Search className="absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
          <Input
            ref={inputRef}
            placeholder="Search by name, email, phone, or AMASI number..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => {
              if (query.trim().length >= 2) setShowSuggestions(true)
            }}
            className="pl-14 pr-28 h-14 text-base rounded-xl shadow-sm border-2 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <kbd className="hidden sm:inline-flex h-6 items-center gap-1 rounded border bg-muted px-2 text-[10px] font-medium text-muted-foreground">
              <Command className="h-3 w-3" />K
            </kbd>
            <Button
              type="submit"
              disabled={isLoading || !query.trim()}
              className="h-10 px-6 rounded-lg"
            >
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Search"
              )}
            </Button>
          </div>

          {/* Autocomplete suggestions dropdown */}
          {showSuggestions && debouncedQuery && (
            suggestionsLoading ? (
              <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-xl z-50 p-4 text-center">
                <Loader2 className="h-4 w-4 animate-spin inline-block mr-2 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Searching...</span>
              </div>
            ) : (
              <SuggestionDropdown
                suggestions={suggestions}
                onSelect={handleSuggestionSelect}
                visible={showSuggestions}
              />
            )
          )}
        </div>
      </form>

      {/* Error state */}
      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-6">
            <p className="text-destructive font-medium">Failed to fetch member data. Please try again.</p>
          </CardContent>
        </Card>
      )}

      {/* Loading skeleton */}
      {isLoading && <ResultSkeleton />}

      {/* No results */}
      {noResults && <NoResultsState searchTerm={searchTerm} />}

      {/* Multiple results - rich cards */}
      {multipleResults && (
        <ResultsList results={results} onSelect={handleSelectMember} />
      )}

      {/* Single result - full profile */}
      {singleResult && member && <MemberProfile member={member} />}

      {/* Empty state - before any search */}
      {!searchTerm && !isLoading && (
        <EmptyState
          recentSearches={recentSearches}
          onQuickSearch={handleQuickSearch}
          onClearRecent={handleClearRecent}
        />
      )}
    </div>
  )
}

export default function SearchPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading...</div>}>
      <SearchContent />
    </Suspense>
  )
}
