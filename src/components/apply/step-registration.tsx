"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { INDIAN_STATES, getMembershipType } from "@/lib/membership-types"
import type { ApplicationFormData } from "@/lib/membership-types"

interface StepRegistrationProps {
  formData: ApplicationFormData
  onChange: (data: Partial<ApplicationFormData>) => void
  errors: Record<string, string>
}

export function StepRegistration({ formData, onChange, errors }: StepRegistrationProps) {
  const type = getMembershipType(formData.membershipType)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Registration & Memberships</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your medical council registration and membership details
        </p>
      </div>

      {formData.membershipType !== "ILM" && (
        <div className="border rounded-lg p-4 space-y-4">
          <h4 className="font-medium">
            MCI / State Medical Council Registration <span className="text-destructive">*</span>
          </h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Registration Number <span className="text-destructive">*</span></Label>
              <Input
                value={formData.mciCouncilNumber}
                onChange={(e) => onChange({ mciCouncilNumber: e.target.value })}
                placeholder="e.g., APMCFMR102167"
              />
              {errors.mciCouncilNumber && (
                <p className="text-xs text-destructive mt-1">{errors.mciCouncilNumber}</p>
              )}
            </div>
            <div>
              <Label>Council State <span className="text-destructive">*</span></Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.mciCouncilState}
                onChange={(e) => onChange({ mciCouncilState: e.target.value })}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
              {errors.mciCouncilState && (
                <p className="text-xs text-destructive mt-1">{errors.mciCouncilState}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {type?.requiresASI && (
        <div className="border rounded-lg p-4 space-y-4">
          <h4 className="font-medium">
            ASI Membership <span className="text-destructive">*</span>
          </h4>
          <p className="text-xs text-muted-foreground">
            Life Members must be a member of the Association of Surgeons of India (ASI)
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>ASI Membership Number <span className="text-destructive">*</span></Label>
              <Input
                value={formData.asiMembershipNo}
                onChange={(e) => onChange({ asiMembershipNo: e.target.value })}
                placeholder="ASI membership number"
              />
              {errors.asiMembershipNo && (
                <p className="text-xs text-destructive mt-1">{errors.asiMembershipNo}</p>
              )}
            </div>
            <div>
              <Label>ASI State</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.asiState}
                onChange={(e) => onChange({ asiState: e.target.value })}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-4">
        <h4 className="font-medium">Other Registration (Optional)</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>IMR Registration Number</Label>
            <Input
              value={formData.imrRegNo}
              onChange={(e) => onChange({ imrRegNo: e.target.value })}
              placeholder="IMR number (if applicable)"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
