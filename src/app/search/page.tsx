"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { Search, User, Mail, Phone, MapPin, GraduationCap, FileText, ExternalLink } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { formatDate, getInitials } from "@/lib/utils"
import type { MemberData } from "@/lib/api"

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

  const member: MemberData | null = data?.data?.[0] || null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Search Member</h2>
        <p className="text-muted-foreground">Look up member details by email or phone number</p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 max-w-xl">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Enter email or phone number..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Searching..." : "Search"}
        </Button>
      </form>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">Failed to fetch member data. Please try again.</p>
          </CardContent>
        </Card>
      )}

      {data && !data.status && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">No member found for &ldquo;{searchTerm}&rdquo;</p>
          </CardContent>
        </Card>
      )}

      {member && (
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-1">
            <CardContent className="pt-6 flex flex-col items-center text-center">
              <Avatar className="h-24 w-24 mb-4">
                {member.profile && <AvatarImage src={member.profile} alt={member.first_name} />}
                <AvatarFallback className="text-lg">
                  {getInitials(`${member.first_name} ${member.middle_name || member.last_name}`)}
                </AvatarFallback>
              </Avatar>
              <h3 className="text-lg font-semibold">
                {member.salutation} {member.first_name} {member.middle_name} {member.last_name}
              </h3>
              <Badge variant={member.status_name === "Membership Number Allotted" ? "success" : "warning"} className="mt-2">
                {member.status_name}
              </Badge>
              <div className="mt-4 space-y-2 w-full text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="h-4 w-4" />
                  <span className="truncate">{member.email}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  <span>{member.mobile_code} {member.mobile}</span>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground">
                  <MapPin className="h-4 w-4" />
                  <span>{member.city}, {member.state_name}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Member Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-4">
                  <h4 className="font-medium flex items-center gap-2">
                    <User className="h-4 w-4" /> Personal Info
                  </h4>
                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Membership No</dt>
                      <dd className="font-medium">{member.membership_no}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Application No</dt>
                      <dd className="font-medium">{member.application_no}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Type</dt>
                      <dd className="font-medium">{member.application_name}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">DOB</dt>
                      <dd>{formatDate(member.dob)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Gender</dt>
                      <dd>{member.gender}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Zone</dt>
                      <dd>{member.zone}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">MCI Number</dt>
                      <dd className="font-medium">{member.mci_council_number}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-muted-foreground">Joined</dt>
                      <dd>{formatDate(member.joining_date)}</dd>
                    </div>
                  </dl>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium flex items-center gap-2">
                    <GraduationCap className="h-4 w-4" /> Education
                  </h4>
                  <dl className="space-y-2 text-sm">
                    <div>
                      <dt className="text-muted-foreground">Undergraduate</dt>
                      <dd>{member.edu_undergrad_college || "N/A"}</dd>
                      <dd className="text-xs text-muted-foreground">
                        {member.edu_undergrad_university} ({member.edu_undergrad_year})
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Postgraduate</dt>
                      <dd>{member.edu_postgrad_degree || "N/A"}</dd>
                      <dd className="text-xs text-muted-foreground">
                        {member.edu_postgrad_college}, {member.edu_postgrad_university} ({member.edu_postgrad_year})
                      </dd>
                    </div>
                    {member.edu_superspecialty_degree && (
                      <div>
                        <dt className="text-muted-foreground">Super Specialty</dt>
                        <dd>{member.edu_superspecialty_degree}</dd>
                        <dd className="text-xs text-muted-foreground">
                          {member.edu_superspecialty_college} ({member.edu_superspecialty_year})
                        </dd>
                      </div>
                    )}
                  </dl>
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <h4 className="font-medium flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Documents
                </h4>
                <div className="grid gap-2 sm:grid-cols-3">
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
                        className="flex items-center gap-2 rounded-lg border p-3 text-sm hover:bg-accent transition-colors"
                      >
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        {doc.label}
                      </a>
                    ))}
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
