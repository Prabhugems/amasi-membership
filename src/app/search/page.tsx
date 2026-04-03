"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Search, User, Mail, Phone, MapPin, GraduationCap, FileText, ExternalLink, Pencil, Loader2, UserX, Shield } from "lucide-react"
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

function SearchContent() {
  const searchParams = useSearchParams()
  const initialQuery = searchParams.get("q") || ""
  const [query, setQuery] = useState(initialQuery)
  const [searchTerm, setSearchTerm] = useState(initialQuery)

  const { data, isLoading, error } = useQuery({
    queryKey: ["member-search", searchTerm],
    queryFn: async () => {
      if (!searchTerm) return null
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(searchTerm)}`)
      return res.json()
    },
    enabled: !!searchTerm,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(query.trim())
  }

  const member: (MemberData & Record<string, any>) | null = data?.data?.[0] || null

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Search Member</h2>
        <p className="text-muted-foreground mt-1">Look up member details by email or phone number</p>
      </div>

      {/* Search bar */}
      <form onSubmit={handleSearch} className="max-w-xl">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Enter email or phone number..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-12 h-12 text-base shadow-sm border-2 focus-visible:border-primary"
            />
          </div>
          <Button type="submit" disabled={isLoading} className="h-12 px-8 text-base shadow-sm">
            {isLoading ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Searching</>
            ) : (
              "Search"
            )}
          </Button>
        </div>
      </form>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="py-6">
            <p className="text-destructive font-medium">Failed to fetch member data. Please try again.</p>
          </CardContent>
        </Card>
      )}

      {data && !data.status && (
        <Card className="border-dashed">
          <CardContent className="py-12 flex flex-col items-center text-center">
            <UserX className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-lg font-medium text-muted-foreground">No member found</p>
            <p className="text-sm text-muted-foreground/70 mt-1">No results for &ldquo;{searchTerm}&rdquo;</p>
          </CardContent>
        </Card>
      )}

      {member && (
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

              <div className="flex items-center gap-2 mt-3">
                <Badge variant={member.status_name === "Membership Number Allotted" ? "success" : "warning"}>
                  {member.status_name}
                </Badge>
                {member.application_name && (
                  <span className={`inline-flex items-center text-xs font-semibold px-2.5 py-0.5 rounded-full border ${TYPE_COLORS[member.application_name?.split(" ")?.[0]] || "bg-muted"}`}>
                    {member.application_name}
                  </span>
                )}
              </div>

              {member.membership_no && (
                <p className="mt-3 text-sm font-mono font-bold text-primary bg-primary/5 px-3 py-1.5 rounded-lg">
                  AMASI #{member.membership_no}
                </p>
              )}

              <Link
                href={`/profile?q=${encodeURIComponent(member.email)}&admin=1`}
                className="mt-4 w-full"
              >
                <Button variant="default" size="sm" className="w-full gap-2">
                  <Pencil className="h-4 w-4" />
                  Edit Profile
                </Button>
              </Link>

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
                  <h4 className="font-semibold text-sm flex items-center gap-2 text-primary">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                      <User className="h-4 w-4" />
                    </div>
                    Personal Info
                  </h4>
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
                  <h4 className="font-semibold text-sm flex items-center gap-2 text-primary">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                      <GraduationCap className="h-4 w-4" />
                    </div>
                    Education
                  </h4>
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
                <h4 className="font-semibold text-sm flex items-center gap-2 text-primary">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-4 w-4" />
                  </div>
                  Documents
                </h4>
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
