"use client"

import { User, Mail, Phone, MapPin, GraduationCap, FileText, ExternalLink, AlertTriangle, Pencil, Shield } from "lucide-react"
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

export function ProfileView({ data, onEdit }: ProfileViewProps) {
  const fullName = [data.firstName, data.middleName, data.lastName].filter(Boolean).join(" ")
  const missingFields = getMissingFields(data)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">My Profile</h2>
          <p className="text-sm text-muted-foreground mt-0.5">AMASI Membership #{data.amasi_number}</p>
        </div>
        <Button onClick={onEdit} className="gap-2">
          <Pencil className="h-4 w-4" />
          Edit Profile
        </Button>
      </div>

      {missingFields.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800">Incomplete Profile</p>
            <p className="text-sm text-amber-700 mt-1 leading-relaxed">
              Please update the following: {missingFields.join(", ")}
            </p>
            <Button variant="outline" size="sm" className="mt-3 border-amber-300 text-amber-800 hover:bg-amber-100" onClick={onEdit}>
              Complete Now
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {/* Profile Card */}
        <Card className="md:col-span-1">
          <CardContent className="pt-6 flex flex-col items-center text-center">
            <Avatar className="h-28 w-28 mb-4 ring-4 ring-muted shadow-sm">
              {data.profilePhoto && <AvatarImage src={data.profilePhoto} alt={fullName} />}
              <AvatarFallback className="text-xl bg-gradient-to-br from-primary/10 to-primary/5">{getInitials(fullName)}</AvatarFallback>
            </Avatar>
            <h3 className="text-lg font-semibold">{data.salutation} {fullName}</h3>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant={data.membership_type === "LM" ? "default" : "secondary"}>
                {data.membership_type}
              </Badge>
              <Badge variant={data.status === "active" ? "success" : "warning"}>
                {data.status === "active" ? "Active" : data.status}
              </Badge>
            </div>
            <div className="mt-5 space-y-2.5 w-full text-sm border-t pt-4">
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="truncate">{data.email}</span>
              </div>
              <div className="flex items-center gap-2.5 text-muted-foreground">
                <Phone className="h-4 w-4 shrink-0" />
                <span>{data.phone}</span>
              </div>
              {data.city && (
                <div className="flex items-center gap-2.5 text-muted-foreground">
                  <MapPin className="h-4 w-4 shrink-0" />
                  <span>{[data.city, data.state].filter(Boolean).join(", ")}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Details Card */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Member Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-4">
                <h4 className="font-medium flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                  <User className="h-4 w-4" /> Personal Info
                </h4>
                <dl className="space-y-3 text-sm">
                  <InfoRow label="Application No" value={data.application_no} />
                  <InfoRow label="DOB" value={formatDate(data.dob)} />
                  <InfoRow label="Gender" value={data.gender} />
                  <InfoRow label="Father's Name" value={data.fatherName} />
                  <InfoRow label="Zone" value={data.zone} />
                </dl>
              </div>

              <div className="space-y-4">
                <h4 className="font-medium flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                  <Shield className="h-4 w-4" /> Registration
                </h4>
                <dl className="space-y-3 text-sm">
                  <VerifiedRow label="MCI Number" value={data.mciCouncilNumber} hasCert={!!data.mciCertificate} />
                  <InfoRow label="MCI State" value={data.mciCouncilState} />
                  {(data.membership_type === "LM" || data.asiMembershipNo) && (
                    <VerifiedRow label="ASI Number" value={data.asiMembershipNo} hasCert={!!data.asiMemberCertificate} />
                  )}
                  {data.imrRegNo && <InfoRow label="IMR Number" value={data.imrRegNo} />}
                </dl>
              </div>
            </div>

            {/* Education */}
            <div className="mt-6 pt-6 border-t space-y-4">
              <h4 className="font-medium flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                <GraduationCap className="h-4 w-4" /> Education
              </h4>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.eduUndergradCollege && (
                  <div className="rounded-lg border p-3.5 bg-muted/30">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Undergraduate</p>
                    <p className="font-semibold text-sm">{data.eduUndergradDegree || "MBBS"}</p>
                    <p className="text-sm text-muted-foreground">{data.eduUndergradCollege}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[data.eduUndergradUniversity, data.eduUndergradYear].filter(Boolean).join(" - ")}</p>
                  </div>
                )}
                {data.eduPostgradDegree && (
                  <div className="rounded-lg border p-3.5 bg-muted/30">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Postgraduate</p>
                    <p className="font-semibold text-sm">{data.eduPostgradDegree}</p>
                    <p className="text-sm text-muted-foreground">{data.eduPostgradCollege}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[data.eduPostgradUniversity, data.eduPostgradYear].filter(Boolean).join(" - ")}</p>
                  </div>
                )}
                {data.eduSuperspecialtyDegree && (
                  <div className="rounded-lg border p-3.5 bg-muted/30">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">Super Specialty</p>
                    <p className="font-semibold text-sm">{data.eduSuperspecialtyDegree}</p>
                    <p className="text-sm text-muted-foreground">{data.eduSuperspecialtyCollege}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{[data.eduSuperspecialtyUniversity, data.eduSuperspecialtyYear].filter(Boolean).join(" - ")}</p>
                  </div>
                )}
                {!data.eduPostgradDegree && !data.eduUndergradCollege && (
                  <p className="text-sm text-muted-foreground italic col-span-full">No education data available</p>
                )}
              </div>
            </div>

            {/* Documents */}
            <div className="mt-6 pt-6 border-t space-y-4">
              <h4 className="font-medium flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
                <FileText className="h-4 w-4" /> Documents
              </h4>
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
                    className="flex items-center gap-2.5 rounded-lg border p-3 text-sm hover:bg-accent hover:border-primary/20 transition-colors group"
                  >
                    <ExternalLink className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                    <span>{doc.label}</span>
                  </a>
                ))}
                {![data.mciCertificate, data.pgDegreeCertificate, data.mbbsDegreeCertificate, data.asiMemberCertificate, data.activeLicense, data.letterHod].some(Boolean) && (
                  <p className="text-sm text-muted-foreground italic col-span-full">No documents uploaded</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function VerifiedRow({ label, value, hasCert }: { label: string; value: string | undefined; hasCert: boolean }) {
  const hasValue = !!(value && value.trim())
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right">
        {hasValue ? (
          <div className="flex items-center gap-2 justify-end">
            <span className="font-medium">{value}</span>
            {hasCert ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">✓ Verified</span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">On record</span>
            )}
          </div>
        ) : (
          <span className="text-muted-foreground italic font-normal text-xs">Upload certificate to verify</span>
        )}
      </dd>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="font-medium text-right truncate">{value || <span className="text-muted-foreground italic font-normal">N/A</span>}</dd>
    </div>
  )
}
