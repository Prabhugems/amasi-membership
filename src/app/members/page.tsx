"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Search, Download } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/utils"
import type { MemberData } from "@/lib/api"
import Link from "next/link"

const SAMPLE_MEMBERS = [
  { email: "vasudhak139@gmail.com" },
  { email: "kpreethi282@gmail.com" },
  { email: "thegreat.victor3@gmail.com" },
  { email: "alamgirtahera@gmail.com" },
  { email: "latasneha2@gmail.com" },
  { email: "drdeepty.sinha@gmail.com" },
  { email: "shank.domain@gmail.com" },
  { email: "harithasagili@gmail.com" },
  { email: "mounikam54321@gmail.com" },
  { email: "rajakanksha0812@gmail.com" },
]

export default function MembersPage() {
  const [searchQuery, setSearchQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")

  const { data: members, isLoading } = useQuery({
    queryKey: ["members-list", SAMPLE_MEMBERS],
    queryFn: async () => {
      const results = await Promise.all(
        SAMPLE_MEMBERS.map(async (m) => {
          const res = await fetch(`/api/members/search?q=${encodeURIComponent(m.email)}`)
          const data = await res.json()
          return data.data?.[0] || null
        })
      )
      return results.filter(Boolean) as MemberData[]
    },
  })

  const filteredMembers = members?.filter((m) => {
    if (!searchTerm) return true
    const search = searchTerm.toLowerCase()
    return (
      `${m.first_name} ${m.middle_name} ${m.last_name}`.toLowerCase().includes(search) ||
      m.email.toLowerCase().includes(search) ||
      m.mobile.includes(search) ||
      m.application_no.toLowerCase().includes(search)
    )
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchTerm(searchQuery)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">All Members</h2>
          <p className="text-muted-foreground">View and manage all AMASI members</p>
        </div>
        <Button variant="outline" size="sm">
          <Download className="h-4 w-4 mr-2" /> Export
        </Button>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by name, email, phone..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              if (!e.target.value) setSearchTerm("")
            }}
            className="pl-9"
          />
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Members {filteredMembers && `(${filteredMembers.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Member ID</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Name</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">App No</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Mobile</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Email</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Status</th>
                    <th className="text-left py-3 px-2 font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMembers?.map((member) => (
                    <tr key={member.id} className="border-b hover:bg-accent/50 transition-colors">
                      <td className="py-3 px-2 font-medium">{member.membership_no}</td>
                      <td className="py-3 px-2">
                        <Link
                          href={`/search?q=${encodeURIComponent(member.email)}`}
                          className="text-primary hover:underline"
                        >
                          {member.salutation} {member.first_name} {member.middle_name} {member.last_name}
                        </Link>
                      </td>
                      <td className="py-3 px-2">{member.application_name}</td>
                      <td className="py-3 px-2">{member.application_no}</td>
                      <td className="py-3 px-2">{member.mobile}</td>
                      <td className="py-3 px-2 text-muted-foreground">{member.email}</td>
                      <td className="py-3 px-2">
                        <Badge variant={member.status_name === "Membership Number Allotted" ? "success" : "warning"}>
                          {member.status_name === "Membership Number Allotted" ? "Active" : member.status_name}
                        </Badge>
                      </td>
                      <td className="py-3 px-2 text-muted-foreground">{formatDate(member.member_reg_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
