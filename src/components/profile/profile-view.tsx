"use client"

import { useState, useEffect, useMemo } from "react"
import { User, Mail, Phone, MapPin, GraduationCap, FileText, ExternalLink, AlertTriangle, Pencil, Shield, Camera, Clock, History, CheckCircle2, ChevronRight, ImageIcon } from "lucide-react"
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

// Section theme colors
const SECTION_THEMES: Record<string, { accent: string; bg: string; iconBg: string; iconText: string; border: string }> = {
  "personal-info":    { accent: "border-l-teal-500",    bg: "bg-gradient-to-br from-teal-50/60 to-white",    iconBg: "bg-teal-100",    iconText: "text-teal-600",    border: "border-teal-100" },
  "address-info":     { accent: "border-l-blue-500",    bg: "bg-gradient-to-br from-blue-50/60 to-white",    iconBg: "bg-blue-100",    iconText: "text-blue-600",    border: "border-blue-100" },
  "education-info":   { accent: "border-l-purple-500",  bg: "bg-gradient-to-br from-purple-50/60 to-white",  iconBg: "bg-purple-100",  iconText: "text-purple-600",  border: "border-purple-100" },
  "registration-info":{ accent: "border-l-emerald-500", bg: "bg-gradient-to-br from-emerald-50/60 to-white", iconBg: "bg-emerald-100", iconText: "text-emerald-600", border: "border-emerald-100" },
  "documents-info":   { accent: "border-l-amber-500",   bg: "bg-gradient-to-br from-amber-50/60 to-white",   iconBg: "bg-amber-100",   iconText: "text-amber-600",   border: "border-amber-100" },
}

/** Membership type badge color map */
function membershipBadgeClass(type: string | undefined) {
  switch (type) {
    case "LM":  return "bg-teal-600 text-white border-teal-600"
    case "ALM": return "bg-blue-600 text-white border-blue-600"
    case "ACM": return "bg-purple-600 text-white border-purple-600"
    case "ILM": return "bg-amber-600 text-white border-amber-600"
    default:    return ""
  }
}

function membershipLabel(type: string | undefined) {
  switch (type) {
    case "LM":  return "Life Member"
    case "ALM": return "Associate Life Member"
    case "ACM": return "Associate College Member"
    case "ILM": return "International Life Member"
    default:    return type
  }
}

/** Check if a URL looks like an image */
function isImageUrl(url: string | undefined): boolean {
  if (!url) return false
  return /\.(jpg|jpeg|png|gif|webp|svg|bmp)/i.test(url) || url.includes("/storage/v1/object/")
}

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
      {/* ===== Profile Header Card ===== */}
      <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300 border-0 shadow-md">
        {/* Full-width teal gradient banner */}
        <div className="bg-gradient-to-r from-teal-700 via-teal-600 to-teal-500 h-32 relative">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImEiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCI+PHBhdGggZD0iTTAgMGg2MHY2MEgweiIgZmlsbD0ibm9uZSIvPjxjaXJjbGUgY3g9IjMwIiBjeT0iMzAiIHI9IjEuNSIgZmlsbD0icmdiYSgyNTUsMjU1LDI1NSwwLjA4KSIvPjwvcGF0dGVybj48L2RlZnM+PHJlY3QgZmlsbD0idXJsKCNhKSIgd2lkdGg9IjEwMCUiIGhlaWdodD0iMTAwJSIvPjwvc3ZnPg==')] opacity-60" />
        </div>
        <CardContent className="relative pb-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4 -mt-16">
            {/* Avatar with white ring */}
            <div className="relative group">
              <Avatar className="h-20 w-20 ring-4 ring-white shadow-xl border-2 border-white">
                {data.profilePhoto && <AvatarImage src={data.profilePhoto} alt={fullName} />}
                <AvatarFallback className="text-xl font-bold bg-gradient-to-br from-teal-100 to-teal-50 text-teal-700">{getInitials(fullName)}</AvatarFallback>
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
                    <span className="font-mono font-semibold text-foreground/80">AMASI #{data.amasi_number}</span>
                    <span className="mx-1.5 text-muted-foreground/40">&middot;</span>
                    Application {data.application_no}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={`text-sm px-3 py-1 ${membershipBadgeClass(data.membership_type)}`}>
                    {membershipLabel(data.membership_type)}
                  </Badge>
                  <Badge
                    variant={data.status === "active" ? "success" : "warning"}
                    className={`text-sm px-3 py-1 ${data.status === "active" ? "bg-green-100 text-green-700 border-green-300" : ""}`}
                  >
                    {data.status === "active" ? (
                      <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> Active</span>
                    ) : data.status}
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

      {/* ===== Profile Completeness ===== */}
      <Card className="hover:shadow-md transition-shadow duration-200">
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

      {/* ===== Main content with section nav sidebar ===== */}
      <div className="flex gap-6">
        {/* Sticky section navigation sidebar */}
        <nav className="hidden lg:block w-56 shrink-0">
          <div className="sticky top-6 space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-3 mb-2">Sections</p>
            {SECTION_IDS.map((section) => {
              const Icon = section.icon
              const isActive = activeSection === section.id
              const theme = SECTION_THEMES[section.id]
              return (
                <button
                  key={section.id}
                  onClick={() => scrollToSection(section.id)}
                  className={`w-full flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 ${
                    isActive
                      ? `bg-teal-50 text-teal-700 border border-teal-200 shadow-sm`
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground border border-transparent"
                  }`}
                >
                  <div className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-200 ${isActive ? (theme?.iconBg ?? "") + " " + (theme?.iconText ?? "") : "bg-muted/60 text-muted-foreground"}`}>
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <span>{section.label}</span>
                  {isActive && <ChevronRight className="h-3 w-3 ml-auto text-teal-500" />}
                </button>
              )
            })}
            <div className="pt-4 border-t mt-4">
              <Button
                onClick={onEdit}
                className="w-full gap-2 bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all duration-200 font-semibold"
                size="lg"
              >
                <Pencil className="h-4 w-4" />
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

          {/* ===== Personal Info Section ===== */}
          <SectionCard id="personal-info" title="Personal Information" icon={User}>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow label="Full Name" value={`${data.salutation} ${fullName}`} />
              <InfoRow label="Application No" value={data.application_no} />
              <InfoRow label="Date of Birth" value={formatDate(data.dob)} />
              <InfoRow label="Gender" value={data.gender} />
              <InfoRow label="Father's Name" value={data.fatherName} />
              <InfoRow label="Nationality" value={data.nationality} />
              <InfoRow label="Zone" value={data.zone} />
              <InfoRow label="Phone" value={data.phone} />
            </div>
          </SectionCard>

          {/* ===== Address Section ===== */}
          <SectionCard id="address-info" title="Address" icon={MapPin}>
            <div className="grid gap-3 sm:grid-cols-2">
              <InfoRow label="Address Line 1" value={data.streetLine1} />
              <InfoRow label="Address Line 2" value={data.streetLine2} />
              <InfoRow label="City" value={data.city} />
              <InfoRow label="State" value={data.state} />
              <InfoRow label="PIN Code" value={data.postalCode} />
              <InfoRow label="Country" value={data.country} />
              {data.landline && <InfoRow label="Landline" value={`${data.stdCode ? data.stdCode + "-" : ""}${data.landline}`} />}
            </div>
          </SectionCard>

          {/* ===== Education Section ===== */}
          <SectionCard id="education-info" title="Education" icon={GraduationCap}>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {data.eduUndergradCollege && (
                <div className="rounded-lg border p-4 bg-gradient-to-br from-purple-50/50 to-white hover:shadow-md transition-all duration-200 group">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">Undergraduate</p>
                  <p className="font-semibold text-sm group-hover:text-purple-700 transition-colors">{data.eduUndergradDegree || "MBBS"}</p>
                  <p className="text-sm text-muted-foreground mt-1">{data.eduUndergradCollege}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{[data.eduUndergradUniversity, data.eduUndergradYear].filter(Boolean).join(" - ")}</p>
                </div>
              )}
              {data.eduPostgradDegree && (
                <div className="rounded-lg border p-4 bg-gradient-to-br from-purple-50/50 to-white hover:shadow-md transition-all duration-200 group">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">Postgraduate</p>
                  <p className="font-semibold text-sm group-hover:text-purple-700 transition-colors">{data.eduPostgradDegree}</p>
                  <p className="text-sm text-muted-foreground mt-1">{data.eduPostgradCollege}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{[data.eduPostgradUniversity, data.eduPostgradYear].filter(Boolean).join(" - ")}</p>
                </div>
              )}
              {data.eduSuperspecialtyDegree && (
                <div className="rounded-lg border p-4 bg-gradient-to-br from-purple-50/50 to-white hover:shadow-md transition-all duration-200 group">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70 mb-1.5">Super Specialty</p>
                  <p className="font-semibold text-sm group-hover:text-purple-700 transition-colors">{data.eduSuperspecialtyDegree}</p>
                  <p className="text-sm text-muted-foreground mt-1">{data.eduSuperspecialtyCollege}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{[data.eduSuperspecialtyUniversity, data.eduSuperspecialtyYear].filter(Boolean).join(" - ")}</p>
                </div>
              )}
              {!data.eduPostgradDegree && !data.eduUndergradCollege && (
                <p className="text-sm text-muted-foreground italic col-span-full">No education data available</p>
              )}
            </div>
          </SectionCard>

          {/* ===== Medical Registration Section ===== */}
          <SectionCard id="registration-info" title="Medical Registration" icon={Shield}>
            <div className="grid gap-3 sm:grid-cols-2">
              <VerifiedRow label="MCI Number" value={data.mciCouncilNumber} hasCert={!!data.mciCertificate} />
              <InfoRow label="MCI State" value={data.mciCouncilState} />
              {(data.membership_type === "LM" || data.asiMembershipNo) && (
                <VerifiedRow label="ASI Number" value={data.asiMembershipNo} hasCert={!!data.asiMemberCertificate} />
              )}
              {data.imrRegNo && <InfoRow label="IMR Number" value={data.imrRegNo} />}
              {data.asiState && <InfoRow label="ASI State" value={data.asiState} />}
            </div>
          </SectionCard>

          {/* ===== Documents Section (filtered by membership type) ===== */}
          <SectionCard id="documents-info" title="Documents" icon={FileText}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(() => {
                const mt = (data.membership_type || "").toUpperCase()
                const docs: { label: string; url: string | null | undefined }[] = []

                // Common: MCI Certificate (all types except ILM)
                if (mt !== "ILM") docs.push({ label: "MCI Certificate", url: data.mciCertificate })

                // PG Degree: LM, ALM, ILM
                if (mt !== "ACM") docs.push({ label: "PG Degree Certificate", url: data.pgDegreeCertificate })

                // MBBS Degree: ACM only
                if (mt === "ACM") docs.push({ label: "MBBS Degree Certificate", url: data.mbbsDegreeCertificate })

                // ASI Certificate: LM only
                if (mt === "LM") docs.push({ label: "ASI Certificate", url: data.asiMemberCertificate })

                // Active License: ILM only
                if (mt === "ILM") docs.push({ label: "Active License", url: data.activeLicense })

                // HOD Letter: ACM only
                if (mt === "ACM") docs.push({ label: "HOD Letter", url: data.letterHod })

                return docs.map((doc) => (
                  <DocumentCard key={doc.label} label={doc.label} url={doc.url} />
                ))
              })()}
            </div>
          </SectionCard>

          {/* Bottom Edit button for mobile */}
          <div className="lg:hidden flex justify-center pt-2 pb-4">
            <Button
              onClick={onEdit}
              size="lg"
              className="gap-2 w-full max-w-sm font-semibold bg-gradient-to-r from-teal-600 to-teal-500 hover:from-teal-700 hover:to-teal-600 text-white shadow-md hover:shadow-lg hover:scale-[1.02] transition-all duration-200"
            >
              <Pencil className="h-4 w-4" />
              Edit Profile
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ===================================================================
   Section Card — wraps each detail section with themed styling
   =================================================================== */
function SectionCard({
  id,
  title,
  icon: Icon,
  children,
}: {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  children: React.ReactNode
}) {
  const theme = SECTION_THEMES[id] ?? SECTION_THEMES["personal-info"]
  return (
    <Card
      id={id}
      className={`overflow-hidden border-l-4 ${theme.accent} ${theme.bg} hover:shadow-md transition-all duration-200 animate-in fade-in slide-in-from-bottom-2`}
    >
      <CardHeader className="pb-4">
        <CardTitle className="text-lg flex items-center gap-2.5">
          <div className={`flex h-8 w-8 items-center justify-center rounded-full ${theme.iconBg} ${theme.iconText} shadow-sm`}>
            <Icon className="h-4 w-4" />
          </div>
          <span>{title}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/* ===================================================================
   Document Card — thumbnail preview, status indicator, hover scale
   =================================================================== */
function DocumentCard({ label, url }: { label: string; url: string | null | undefined }) {
  const uploaded = !!url
  return (
    <a
      href={url ?? "#"}
      target={uploaded ? "_blank" : undefined}
      rel="noopener noreferrer"
      onClick={(e) => { if (!uploaded) e.preventDefault() }}
      className={`flex items-center gap-3 rounded-xl border p-3.5 text-sm transition-all duration-200 group ${
        uploaded
          ? "hover:shadow-md hover:border-teal-200 hover:scale-[1.02] cursor-pointer"
          : "opacity-60 cursor-default"
      }`}
    >
      {/* Thumbnail or status icon */}
      <div className="relative h-12 w-12 rounded-lg overflow-hidden shrink-0 border bg-muted/30">
        {uploaded && isImageUrl(url) ? (
          <img src={url!} alt={label} className="h-full w-full object-cover" />
        ) : (
          <div className={`h-full w-full flex items-center justify-center ${uploaded ? "bg-green-50" : "bg-amber-50"}`}>
            {uploaded ? (
              <CheckCircle2 className="h-5 w-5 text-green-500" />
            ) : (
              <ImageIcon className="h-5 w-5 text-amber-400" />
            )}
          </div>
        )}
        {/* Status dot */}
        <div className={`absolute top-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-white ${uploaded ? "bg-green-500" : "bg-amber-400"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <span className="font-medium block truncate">{label}</span>
        <span className={`text-xs font-medium ${uploaded ? "text-green-600" : "text-amber-500"}`}>
          {uploaded ? "Uploaded" : "Missing"}
        </span>
      </div>
      {uploaded && (
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground group-hover:text-teal-600 transition-colors shrink-0" />
      )}
    </a>
  )
}

/* ===================================================================
   Info Row — label/value pair with divider styling
   =================================================================== */
function InfoRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="rounded-lg border p-3.5 bg-white/60 hover:bg-white/90 transition-colors duration-150">
      <dt className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">{label}</dt>
      <dd className="font-semibold mt-1 text-[15px] truncate">
        {value || <span className="text-muted-foreground italic font-normal text-sm">N/A</span>}
      </dd>
    </div>
  )
}

/* ===================================================================
   Verified Row — with verification badge
   =================================================================== */
function VerifiedRow({ label, value, hasCert }: { label: string; value: string | undefined; hasCert: boolean }) {
  const hasValue = !!(value && value.trim())
  return (
    <div className="rounded-lg border p-3.5 bg-white/60 hover:bg-white/90 transition-colors duration-150">
      <dt className="text-[10px] font-bold text-muted-foreground/70 uppercase tracking-widest">{label}</dt>
      <dd className="mt-1">
        {hasValue ? (
          <div className="flex items-center gap-2">
            <span className="font-semibold text-[15px]">{value}</span>
            {hasCert ? (
              <Badge variant="success" className="text-[10px] gap-1 px-2 py-0.5 bg-green-100 text-green-700 border-green-300">
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
