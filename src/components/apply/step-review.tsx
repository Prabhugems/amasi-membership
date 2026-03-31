"use client"

import { Badge } from "@/components/ui/badge"
import { getMembershipType, calculateFee, DOC_LABELS } from "@/lib/membership-types"
import type { ApplicationFormData, DocType } from "@/lib/membership-types"
import { CheckCircle, AlertCircle, Edit2 } from "lucide-react"

interface StepReviewProps {
  formData: ApplicationFormData
  onGoToStep: (step: number) => void
}

export function StepReview({ formData, onGoToStep }: StepReviewProps) {
  const type = getMembershipType(formData.membershipType)
  if (!type) return null

  const fee = calculateFee(type)

  const allDocsVerified = type.requiredDocs.every(
    (doc) => formData.documents[doc]?.file && (doc === "profile" || formData.documents[doc]?.ocrResult?.verified)
  )

  const Section = ({
    title,
    step,
    children,
  }: {
    title: string
    step: number
    children: React.ReactNode
  }) => (
    <div className="border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium">{title}</h4>
        <button
          type="button"
          onClick={() => onGoToStep(step)}
          className="text-xs text-primary hover:underline flex items-center gap-1"
        >
          <Edit2 className="h-3 w-3" /> Edit
        </button>
      </div>
      {children}
    </div>
  )

  const Field = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between py-1">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value || "—"}</span>
    </div>
  )

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Review Application</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Review all details before submitting. Click Edit to make changes.
        </p>
      </div>

      <Section title="Membership Type" step={0}>
        <div className="flex items-center gap-3">
          <Badge>{type.shortName}</Badge>
          <span className="font-medium">{type.name}</span>
        </div>
      </Section>

      <Section title="Personal Details" step={1}>
        <div className="grid sm:grid-cols-2 gap-x-8">
          <Field label="Name" value={`${formData.salutation} ${formData.firstName} ${formData.middleName} ${formData.lastName}`.trim()} />
          <Field label="DOB" value={formData.dob} />
          <Field label="Gender" value={formData.gender} />
          <Field label="Email" value={formData.email} />
          <Field label="Mobile" value={`${formData.mobileCode} ${formData.mobile}`} />
          <Field label="City" value={`${formData.city}, ${formData.state}`} />
          <Field label="PIN" value={formData.pin} />
          <Field label="Zone" value={formData.zone} />
        </div>
      </Section>

      <Section title="Education" step={2}>
        <div className="grid sm:grid-cols-2 gap-x-8">
          {type.requiresMBBS && (
            <>
              <Field label="MBBS College" value={formData.eduUndergradCollege} />
              <Field label="MBBS Year" value={formData.eduUndergradYear} />
            </>
          )}
          {type.requiresPG && (
            <>
              <Field label="PG Degree" value={formData.eduPostgradDegree} />
              <Field label="PG College" value={formData.eduPostgradCollege} />
              <Field label="PG University" value={formData.eduPostgradUniversity} />
              <Field label="PG Year" value={formData.eduPostgradYear} />
            </>
          )}
          {formData.eduSuperspecialtyDegree && (
            <>
              <Field label="Super Specialty" value={formData.eduSuperspecialtyDegree} />
              <Field label="SS College" value={formData.eduSuperspecialtyCollege} />
            </>
          )}
        </div>
      </Section>

      <Section title="Registration" step={3}>
        <div className="grid sm:grid-cols-2 gap-x-8">
          <Field label="MCI Number" value={formData.mciCouncilNumber} />
          <Field label="Council State" value={formData.mciCouncilState} />
          {type.requiresASI && <Field label="ASI Number" value={formData.asiMembershipNo} />}
          {formData.imrRegNo && <Field label="IMR Number" value={formData.imrRegNo} />}
        </div>
      </Section>

      <Section title="Documents" step={4}>
        <div className="space-y-2">
          {type.requiredDocs.map((doc) => {
            const upload = formData.documents[doc]
            const isProfile = doc === "profile"
            const verified = isProfile ? !!upload?.file : upload?.ocrResult?.verified

            return (
              <div key={doc} className="flex items-center justify-between py-1">
                <span className="text-sm">{DOC_LABELS[doc as DocType]}</span>
                {upload?.file ? (
                  <div className="flex items-center gap-1">
                    {verified ? (
                      <Badge variant="success" className="gap-1">
                        <CheckCircle className="h-3 w-3" /> Verified
                      </Badge>
                    ) : (
                      <Badge variant="warning" className="gap-1">
                        <AlertCircle className="h-3 w-3" /> Needs Review
                      </Badge>
                    )}
                  </div>
                ) : (
                  <Badge variant="destructive">Missing</Badge>
                )}
              </div>
            )
          })}
        </div>
      </Section>

      <div className="border rounded-lg p-4 bg-muted/30">
        <h4 className="font-medium mb-3">Fee Summary</h4>
        <div className="space-y-1">
          <Field label="Membership Fee" value={`${fee.currency}${fee.baseFee.toLocaleString()}`} />
          <Field label={`Processing Fee (${type.processingFeePercent}%)`} value={`${fee.currency}${fee.processingFee.toLocaleString()}`} />
          <div className="border-t pt-1 mt-1">
            <Field label="Total Payable" value={`${fee.currency}${fee.totalFee.toLocaleString()}`} />
          </div>
        </div>
      </div>

      {!allDocsVerified && (
        <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg text-warning text-sm">
          <AlertCircle className="h-4 w-4" />
          Some documents are not verified. You can still submit, but verification may take longer.
        </div>
      )}
    </div>
  )
}
