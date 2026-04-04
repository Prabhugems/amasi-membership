"use client"

import { useState, useEffect, useMemo } from "react"
import { User, Mail, Phone, MapPin, GraduationCap, FileText, ExternalLink, AlertTriangle, Pencil, Shield, Camera, Clock, History, CheckCircle2, ChevronRight } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { formatDate, getInitials } from "@/lib/utils"
import type { ProfileFormData } from "@/lib/profile-mapper"
import { getMissingFields } from "@/lib/profile-mapper"

interface ProfileViewProps {
  data: ProfileFormData
  onEdit: () => void
}

const SECTION_IDS = [
  { id: "personal-info", label: "Personal Info", icon: User },
  { id: "address-info", label: "Address", icon: MapPin },
  { id: "education-info", label: "Education", icon: GraduationCap },
  { id: "registration-info", label: "Medical Registration", icon: Shield },
  { id: "documents-info", label: "Documents", icon: FileText },
]

export function ProfileView({ data, onEdit }: ProfileViewProps) {
  const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(" ")
  const missingFields = getMissingFields(data)
  const [activeSection, setActiveSection] = useState(SECTION_IDS[0].id)

  // Profile completeness calculation
  const { completionPercent, filledCount, totalCount } = useMemo(() => {
    const fields = [
      data.firstName, data.lastName, data.dob, data.gender, data.fatherName, data.nationality,
      data.streetLine1, data.city, data.state, data.postalCode, data.country,
      data.eduUndergradCollege, data.eduPostgradDegree, data.eduPostgradCollege,
      data.mciCouncilNumber, data.mciCouncilState,
      data.profilePhoto,
    ]
    const filled = fields.filter(Boolean).length
    return { completionPercent: Math.round((filled / fields.length) * 100), filledCount: filled, totalCount: fields.length }
  }, [data])

  // Track active section on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: "-100px 0px -60% 0px", threshold: 0.1 }
    )
    for (const s of SECTION_IDS) {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [])

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" })
      setActiveSection(id)
    }
  }

  const completionColor = completionPercent === 100 ? "bg-green-500" : completionPercent >= 70 ? "bg-teal-500" : "bg-amber-500"
  const completionTextColor = completionPercent === 100 ? "text-green-600" : completionPercent >= 70 ? "text-teal-600" : "text-amber-600"

  return (
    <div className="space-y-6">
      {/* Profile Header Card */}
      <Card className="overflow-hidden">
        <div className="bg-gradient-to-r from-teal-600 to-teal-500 h-28 relative" />
        <CardContent className="relative pb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 -mt-14">
            {/* Photo with change overlay */}
            <div className="relative group">
              <Avatar className="h-28 w-28 ring-4 ring-background shadow-lg border-2 border-white">
                {data.profilePhoto && <AvatarImage src={data.profilePhoto} alt={fullName} />}
                <AvatarFallback className="text-2xl bg-gradient-to-br from-teal-100 to-teal-50 text-teal-700">{getInitials(fullName)}</AvatarFallback>
              </Avatar>
              <button
                onClick={onEdit}
                className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 cursor-pointer"
              >
                <div className="flex flex-col items-center gap-1">
                  <Camera className="h-5 w-5 text-white" />
                  <span className="text-[10px] text-white font-medium">Change</span>
                </div>
              </button>
            </div>

            <div className="flex-1 sm:pb-1">
              <div className="flex items-start justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight">{data.salutation} {fullName}</h2>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    AMASI #{data.amasi_number} &middot; Application {data.application_no}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={data.membership_type === "LM" ? "default" : "secondary"} className="text-sm px-3 py-1">
                    {data.membership_type === "LM" ? "Life Member" : data.membership_type === "ALM" ? "Associate Life Member" : data.membership_type === "ACM" ? "Associate College Member" : data.membership_type === "ILM" ? "International Life Member" : data.membership_type}
                  </Badge>
                  <Badge variant={data.status === "active" ? "success" : "warning"} className="text-sm px-3 py-1">
                    {data.status === "active" ? "Active" : data.status}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2.5 flex-wrap text-sm text-muted-foreground">
                <span className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5" />{data.email}</span>
                <span className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" />{data.phone}</span>
                {data.city && (
                  <span className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{[data.city, data.state].filter(Boolean).join(", ")}</span>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Profile Completeness */}
      <Card>
        <CardContent className="py-5 px-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Profile Completeness</span>
              <span className="text-xs text-muted-foreground">({filledCount}/{totalCount} fields)</span>
            </div>
            <span className={`text-lg font-bold tabular-nums ${completionTextColor}`}>
              {completionPercent}%
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden">
            <div
              className={`h-3 rounded-full transition-all duration-700 ease-out ${completionColor}`}
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          {missingFields.length > 0 && (
            <div className="mt-4 pt-3 border-t">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-amber-700">Missing fields:</p>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {missingFields.map((f) => (
                      <Badge key={f} variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 py-0.5">
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
                <Button size="sm" onClick={onEdit} className="shrink-0 gap-1.5">
                  <Pencil className="h-3 w-3" />
                  Complete Now
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main content with section nav sidebar */}
      <div className="flex gap-6">
        {/* Sticky section navigation sidebar */}
        <nav className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-6 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-3 mb-2">Sections</p>
            {SECTION_IDS.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              return (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? "bg-teal-50 text-teal-700 border border-teal-200"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground border border-transparent"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{section.label}</span>
                  {isActive && <ChevronRight className="h-3 w-3 ml-auto" />}
                </button>
              )
            })}
            <div className="pt-4 border-t mt-4">
              <Button onClick={onEdit} className="w-full gap-2" size="sm">
                <Pencil className="h-3.5 w-3.5" />
                Edit Profile
              </Button>
            </div>
          </div>
        </nav>

        {/* Main detail content */}
        <div className="flex-1 min-w-0 space-y-6">
          {/* Change history bar */}
          <div className="flex items-center justify-between text-sm px-1">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>Last updated: {(data as any).updatedAt ? formatDate((data as any).updatedAt) : new Date().toLocaleDateString("en-IN", { year: "numeric", month: "long", day: "numeric" })}</span>
            </div>
            <button className="flex items-center gap-1.5 text-teal-600 hover:text-teal-700 font-medium text-xs transition-colors">
              <History className="h-3.5 w-3.5" />
              View change history
            </button>
          </div>

          {/* Personal Info Section */}
          <Card id="personal-info">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-600">
                  <User className="h-4 w-4" />
                </div>
                Personal Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoRow label="Full Name" value={`${data.salutation} ${fullName}`} />
                <InfoRow label="Application No" value={data.application_no} />
                <InfoRow label="Date of Birth" value={formatDate(data.dob)} />
                <InfoRow label="Gender" value={data.gender} />
                <InfoRow label="Father's Name" value={data.fatherName} />
                <InfoRow label="Nationality" value={data.nationality} />
                <InfoRow label="Zone" value={data.zone} />
                <InfoRow label="Phone" value={data.phone} />
              </div>
            </CardContent>
          </Card>

          {/* Address Section */}
          <Card id="address-info">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-600">
                  <MapPin className="h-4 w-4" />
                </div>
                Address
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <InfoRow label="Address Line 1" value={data.streetLine1} />
                <InfoRow label="Address Line 2" value={data.streetLine2} />
                <InfoRow label="City" value={data.city} />
                <InfoRow label="State" value={data.state} />
                <InfoRow label="PIN Code" value={data.postalCode} />
                <InfoRow label="Country" value={data.country} />
                {data.landline && <InfoRow label="Landline" value={`${data.stdCode ? data.stdCode + "-" : ""}${data.landline}`} />}
              </div>
            </CardContent>
          </Card>

          {/* Education Section */}
          <Card id="education-info">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-600">
                  <GraduationCap className="h-4 w-4" />
                </div>
                Education
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.eduUndergradCollege && (
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Undergraduate</p>
                    <p className="font-semibold text-sm">{data.eduUndergradDegree || "MBBS"}</p>
                    <p className="text-sm text-muted-foreground mt-1">{data.eduUndergradCollege}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[data.eduUndergradUniversity, data.eduUndergradYear].filter(Boolean).join(" - ")}</p>
                  </div>
                )}
                {data.eduPostgradDegree && (
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Postgraduate</p>
                    <p className="font-semibold text-sm">{data.eduPostgradDegree}</p>
                    <p className="text-sm text-muted-foreground mt-1">{data.eduPostgradCollege}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[data.eduPostgradUniversity, data.eduPostgradYear].filter(Boolean).join(" - ")}</p>
                  </div>
                )}
                {data.eduSuperspecialtyDegree && (
                  <div className="rounded-lg border p-4 bg-muted/30">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">Super Specialty</p>
                    <p className="font-semibold text-sm">{data.eduSuperspecialtyDegree}</p>
                    <p className="text-sm text-muted-foreground mt-1">{data.eduSuperspecialtyCollege}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[data.eduSuperspecialtyUniversity, data.eduSuperspecialtyYear].filter(Boolean).join(" - ")}</p>
                  </div>
                )}
                {!data.eduPostgradDegree && !data.eduUndergradCollege && (
                  <p className="text-sm text-muted-foreground italic col-span-full">No education data available</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Medical Registration Section */}
          <Card id="registration-info">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600">
                  <Shield className="h-4 w-4" />
                </div>
                Medical Registration
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <VerifiedRow label="MCI Number" value={data.mciCouncilNumber} hasCert={!!data.mciCertificate} />
                <InfoRow label="MCI State" value={data.mciCouncilState} />
                {(data.membership_type === "LM" || data.asiMembershipNo) && (
                  <VerifiedRow label="ASI Number" value={data.asiMembershipNo} hasCert={!!data.asiMemberCertificate} />
                )}
                {data.imrRegNo && <InfoRow label="IMR Number" value={data.imrRegNo} />}
                {data.asiState && <InfoRow label="ASI State" value={data.asiState} />}
              </div>
            </CardContent>
          </Card>

          {/* Documents Section */}
          <Card id="documents-info">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
                  <FileText className="h-4 w-4" />
                </div>
                Documents
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 sm:grid-cols-3">
                {[
                  { label: "MCI Certificate", url: data.mciCertificate },
                  { label: "PG Degree", url: data.pgDegreeCertificate },
                  { label: "MBBS Degree", url: data.mbbsDegreeCertificate },
                  { label: "ASI Certificate", url: data.asiMemberCertificate },
                  { label: "Active License", url: data.activeLicense },
                  { label: "HOD Letter", url: data.letterHod },
                ].filter((d) => d.url).map((doc) => (
                  <a
                    key={doc.label}
                    href={doc.url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 rounded-lg border p-3 text-sm hover:bg-accent hover:border-teal-200 transition-colors group"
                  >
                    <div className="h-8 w-8 rounded-md bg-green-100 flex items-center justify-center shrink-0">
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    </div>
                    <div className="min-w-0">
                      <span className="font-medium block truncate">{doc.label}</span>
                      <span className="text-xs text-green-600">Uploaded</span>
                    </div>
                    <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-teal-600 transition-colors shrink-0 ml-auto" />
                  </a>
                ))}
                {![data.mciCertificate, data.pgDegreeCertificate, data.mbbsDegreeCertificate, data.asiMemberCertificate, data.activeLicense, data.letterHod].some(Boolean) && (
                  <p className="text-sm text-muted-foreground italic col-span-full">No documents uploaded</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Bottom Edit button for mobile */}
          <div className="lg:hidden flex justify-center pt-2 pb-4">
            <Button onClick={onEdit} size="lg" className="gap-2 w-full max-w-sm font-semibold">
              <Pencil className="h-4 w-4" />
              Edit Profile
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function VerifiedRow({ label, value, hasCert }: { label: string; value: string | undefined; hasCert: boolean }) {
  const hasValue = !!(value && value.trim())
  return (
    <div className="rounded-lg border p-3.5 bg-muted/20">
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="mt-1.5">
        {hasValue ? (
          <div className="flex items-center gap-2">
            <span className="font-semibold">{value}</span>
            {hasCert ? (
              <Badge variant="success" className="text-[10px] gap-1 px-2 py-0.5">
                <CheckCircle2 className="h-3 w-3" /> Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] text-blue-600 border-blue-200 bg-blue-50 px-2 py-0.5">On record</Badge>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground italic text-sm">Not provided</span>
        )}
      </dd>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="rounded-lg border p-3.5 bg-muted/20">
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="font-semibold mt-1.5 truncate">
        {value || <span className="text-muted-foreground italic font-normal text-sm">N/A</span>}
      </dd>
    </div>
  )
}
