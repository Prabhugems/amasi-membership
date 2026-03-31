"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Search, CheckCircle, Clock, FileCheck, UserCheck, Award } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import type { MemberData } from "@/lib/api"
import { formatDate } from "@/lib/utils"
import { cn } from "@/lib/utils"

const STATUS_STEPS = [
  { label: "Submitted", icon: FileCheck, status: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { label: "Payment Verified", icon: CheckCircle, status: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  { label: "Documents Verified", icon: FileCheck, status: [5, 6, 7, 8, 9, 10, 11, 12] },
  { label: "Under Review", icon: Clock, status: [8, 9, 10, 11, 12] },
  { label: "Membership Allotted", icon: Award, status: [12] },
]

export default function StatusPage() {
  const [query, setQuery] = useState("")
  const [searchTerm, setSearchTerm] = useState("")

  const { data, isLoading } = useQuery({
    queryKey: ["status-check", searchTerm],
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
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Track Application</h2>
        <p className="text-muted-foreground">
          Check the status of your membership application
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Enter your email or phone number..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={isLoading}>
          {isLoading ? "Checking..." : "Check Status"}
        </Button>
      </form>

      {data && !data.status && searchTerm && (
        <Card>
          <CardContent className="pt-6 text-center">
            <p className="text-muted-foreground">
              No application found for &ldquo;{searchTerm}&rdquo;.
              Please check the email or phone number used during application.
            </p>
          </CardContent>
        </Card>
      )}

      {member && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">
                  {member.salutation} {member.first_name} {member.middle_name} {member.last_name}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {member.application_name} | App No: {member.application_no}
                </p>
              </div>
              <Badge variant={member.status_name === "Membership Number Allotted" ? "success" : "warning"}>
                {member.status_name}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Membership No:</span>
                  <span className="ml-2 font-medium">{member.membership_no || "Pending"}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Applied:</span>
                  <span className="ml-2">{formatDate(member.member_reg_date)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Joined:</span>
                  <span className="ml-2">{formatDate(member.joining_date)}</span>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-4">Application Progress</h4>
                <div className="space-y-4">
                  {STATUS_STEPS.map((step, index) => {
                    const isCompleted = step.status.includes(member.application_status)
                    const Icon = step.icon
                    return (
                      <div key={step.label} className="flex items-center gap-3">
                        <div
                          className={cn(
                            "h-8 w-8 rounded-full flex items-center justify-center",
                            isCompleted
                              ? "bg-success text-success-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1">
                          <p className={cn(
                            "text-sm font-medium",
                            isCompleted ? "text-foreground" : "text-muted-foreground"
                          )}>
                            {step.label}
                          </p>
                        </div>
                        {isCompleted && (
                          <CheckCircle className="h-4 w-4 text-success" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
