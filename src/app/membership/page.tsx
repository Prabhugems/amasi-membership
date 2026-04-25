"use client"

import { useState, useEffect } from "react"
import {
  Search, Loader2, User, CreditCard, Award, MapPin, GraduationCap,
  CheckCircle, Clock, Shield, ExternalLink, Phone, Mail, Hash, FileText as FileIcon,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

function membershipLabel(type: string): string {
  const mt = (type || "").toUpperCase()
  if (mt.includes("LM") && !mt.includes("ALM") && !mt.includes("ILM")) return "Life Member (LM)"
  if (mt.includes("ALM") || mt.includes("ASSOCIATE LIFE")) return "Associate Life Member (ALM)"
  if (mt.includes("ACM") || mt.includes("CANDIDATE")) return "Associate Candidate Member (ACM)"
  if (mt.includes("ILM") || mt.includes("INTERNATIONAL")) return "International Life Member (ILM)"
  return type || "Member"
}

function membershipColor(type: string): string {
  const mt = (type || "").toUpperCase()
  if (mt.includes("LM") && !mt.includes("ALM") && !mt.includes("ILM")) return "bg-teal-100 dark:bg-teal-500/20 text-teal-700 dark:text-teal-300 border-teal-300"
  if (mt.includes("ALM")) return "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border-blue-300"
  if (mt.includes("ACM")) return "bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-300"
  if (mt.includes("ILM")) return "bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-300"
  return "bg-gray-100 dark:bg-gray-500/20 text-gray-700 dark:text-gray-300 border-gray-300"
}

export default function KnowYourMembershipPage() {
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [member, setMember] = useState<any>(null)
  const [notFound, setNotFound] = useState(false)
  const [searched, setSearched] = useState(false)
  const [fmasYear, setFmasYear] = useState<number | null>(null)

  useEffect(() => {
    const amasi = member?.amasi_number
    if (!amasi) {
      setFmasYear(null)
      return
    }
    let cancelled = false
    fetch(`/api/credential?type=FMAS&id=${amasi}`)
      .then((r) => (r.status === 404 ? null : r.json()))
      .then((d) => {
        if (cancelled) return
        setFmasYear(d?.credential?.year ?? null)
      })
      .catch(() => {
        if (!cancelled) setFmasYear(null)
      })
    return () => { cancelled = true }
  }, [member?.amasi_number])

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return

    setLoading(true)
    setNotFound(false)
    setMember(null)
    setSearched(true)

    try {
      const res = await fetch(`/api/members/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()
      if (data.status && data.data?.length > 0) {
        setMember(data.data[0])
      } else {
        setNotFound(true)
      }
    } catch {
      setNotFound(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Shield className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-2xl font-bold tracking-tight">Know Your Membership</h2>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Check your AMASI membership details using your phone number, email address, or AMASI membership number
        </p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3 max-w-lg mx-auto">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Phone, email, or AMASI number..."
            className="pl-10 h-12 text-base"
          />
        </div>
        <Button type="submit" disabled={loading || !query.trim()} className="h-12 px-6">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {/* Result */}
      {loading && (
        <div className="text-center py-12">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-3">Searching...</p>
        </div>
      )}

      {notFound && !loading && (
        <Card className="max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center mb-4">
              <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="font-semibold">No membership found</p>
            <p className="text-sm text-muted-foreground mt-2">
              We couldn&apos;t find a membership matching &quot;{query}&quot;. Please check and try again.
            </p>
            <div className="mt-4 pt-4 border-t text-sm text-muted-foreground">
              <p>Not a member yet?</p>
              <a href="/apply" className="text-primary font-medium hover:underline">Apply for membership</a>
            </div>
          </CardContent>
        </Card>
      )}

      {member && !loading && (
        <Card className="max-w-lg mx-auto overflow-hidden">
          {/* Header banner */}
          <div className="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 p-6 text-white relative">
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjMwIiBjeT0iMzAiIHI9IjEuNSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNhKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-60" />
            <div className="relative">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="h-5 w-5 text-green-300" />
                <span className="text-sm font-medium text-green-200">Verified Member</span>
              </div>
              <h3 className="text-xl font-bold">{member.salutation} {member.name}</h3>
              <p className="text-white/70 text-sm mt-1 font-mono">AMASI #{member.amasi_number || member.membership_no}</p>
            </div>
          </div>

          <CardContent className="p-6 space-y-5">
            {/* Membership badge */}
            <div className="flex items-center gap-3">
              <Badge className={`text-sm px-3 py-1 ${membershipColor(member.membership_type)}`}>
                {membershipLabel(member.membership_type)}
              </Badge>
              {member.is_active !== false && (
                <Badge className="bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300 border-green-300 text-sm px-3 py-1">
                  <CheckCircle className="h-3 w-3 mr-1" /> Active
                </Badge>
              )}
            </div>

            {/* Details grid */}
            <div className="grid gap-3 sm:grid-cols-2">
              {member.amasi_number && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <Hash className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">AMASI Number</p>
                    <p className="text-sm font-semibold font-mono">#{member.amasi_number}</p>
                  </div>
                </div>
              )}
              {member.membership_type && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <CreditCard className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Membership Type</p>
                    <p className="text-sm font-semibold">{membershipLabel(member.membership_type)}</p>
                  </div>
                </div>
              )}
              {member.pg_degree && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <GraduationCap className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">PG Degree</p>
                    <p className="text-sm font-semibold">{member.pg_degree}</p>
                  </div>
                </div>
              )}
              {(member.city || member.state) && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <MapPin className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Location</p>
                    <p className="text-sm font-semibold">{[member.city, member.state].filter(Boolean).join(", ")}</p>
                  </div>
                </div>
              )}
              {member.zone && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                  <User className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Zone</p>
                    <p className="text-sm font-semibold">{member.zone}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Membership Journey */}
            <div className="pt-3 border-t">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-4">Your Membership Journey</h4>
              <div className="space-y-0">
                {[
                  { label: "Application Submitted", desc: member.application_no ? `Ref: ${member.application_no}` : "Application received", date: member.member_reg_date, done: true, icon: FileIcon },
                  { label: "Payment Confirmed", desc: "Membership fee paid", date: member.member_reg_date, done: true, icon: CreditCard },
                  { label: "Documents Verified", desc: "AI & manual review complete", date: member.member_reg_date, done: true, icon: CheckCircle },
                  { label: "Membership Approved", desc: `AMASI #${member.amasi_number || member.membership_no} assigned`, date: member.joining_date, done: true, icon: Award },
                  { label: "Member Portal Active", desc: "Card, certificate & portal ready", date: member.joining_date, done: true, icon: Shield },
                ].map((step, i, arr) => (
                  <div key={i} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${step.done ? "bg-green-100 dark:bg-green-500/20 text-green-600" : "bg-muted text-muted-foreground"}`}>
                        <step.icon className="h-4 w-4" />
                      </div>
                      {i < arr.length - 1 && (
                        <div className={`w-0.5 flex-1 min-h-[24px] ${step.done ? "bg-green-200" : "bg-muted"}`} />
                      )}
                    </div>
                    <div className="pb-5">
                      <p className={`text-sm font-semibold ${step.done ? "text-foreground" : "text-muted-foreground"}`}>{step.label}</p>
                      <p className="text-xs text-muted-foreground">{step.desc}</p>
                      {step.date && (
                        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                          {new Date(step.date).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t flex flex-wrap gap-2">
              <a href={`/card?id=${member.email || member.amasi_number}`}>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <CreditCard className="h-3.5 w-3.5" /> View Card
                </Button>
              </a>
              <a href={`/member/certificate?id=${member.amasi_number}`}>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Award className="h-3.5 w-3.5" /> Certificate
                </Button>
              </a>
              {fmasYear !== null && (
                <a href={`/member/fmas-certificate?id=${member.amasi_number}`}>
                  <Button variant="outline" size="sm" className="gap-1.5 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-400/30 dark:text-amber-300">
                    <Award className="h-3.5 w-3.5" /> FMAS Cert ({fmasYear})
                  </Button>
                </a>
              )}
              <a href={`/verify?id=${member.amasi_number}`}>
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <Shield className="h-3.5 w-3.5" /> Verify
                </Button>
              </a>
              <a href="/member">
                <Button variant="outline" size="sm" className="gap-1.5 text-xs">
                  <User className="h-3.5 w-3.5" /> Member Portal
                </Button>
              </a>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help text */}
      {!searched && (
        <div className="text-center text-sm text-muted-foreground space-y-4 max-w-md mx-auto">
          <div className="grid grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border bg-card">
              <Phone className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs font-medium">Phone Number</p>
              <p className="text-[10px] text-muted-foreground mt-1">10-digit mobile</p>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <Mail className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs font-medium">Email Address</p>
              <p className="text-[10px] text-muted-foreground mt-1">Registered email</p>
            </div>
            <div className="p-4 rounded-xl border bg-card">
              <Hash className="h-5 w-5 mx-auto mb-2 text-muted-foreground" />
              <p className="text-xs font-medium">AMASI Number</p>
              <p className="text-[10px] text-muted-foreground mt-1">e.g. 16311</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
