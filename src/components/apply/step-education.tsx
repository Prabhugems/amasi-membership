"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getMembershipType } from "@/lib/membership-types"
import type { ApplicationFormData } from "@/lib/membership-types"

interface StepEducationProps {
  formData: ApplicationFormData
  onChange: (data: Partial<ApplicationFormData>) => void
  errors: Record<string, string>
}

export function StepEducation({ formData, onChange, errors }: StepEducationProps) {
  const type = getMembershipType(formData.membershipType)
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 50 }, (_, i) => currentYear - i)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Education Details</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your educational qualifications
        </p>
      </div>

      <div className="border rounded-lg p-4 space-y-4">
        <h4 className="font-medium">
          Undergraduate (MBBS)
          {type?.requiresMBBS && <span className="text-destructive ml-1">*</span>}
        </h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Degree</Label>
            <Input
              value={formData.eduUndergradDegree}
              onChange={(e) => onChange({ eduUndergradDegree: e.target.value })}
              placeholder="e.g., MBBS"
            />
          </div>
          <div>
            <Label>
              College
              {type?.requiresMBBS && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              value={formData.eduUndergradCollege}
              onChange={(e) => onChange({ eduUndergradCollege: e.target.value })}
              placeholder="Medical college name"
            />
            {errors.eduUndergradCollege && (
              <p className="text-xs text-destructive mt-1">{errors.eduUndergradCollege}</p>
            )}
          </div>
          <div>
            <Label>
              University
              {type?.requiresMBBS && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              value={formData.eduUndergradUniversity}
              onChange={(e) => onChange({ eduUndergradUniversity: e.target.value })}
              placeholder="University name"
            />
            {errors.eduUndergradUniversity && (
              <p className="text-xs text-destructive mt-1">{errors.eduUndergradUniversity}</p>
            )}
          </div>
          <div>
            <Label>
              Year of Passing
              {type?.requiresMBBS && <span className="text-destructive ml-1">*</span>}
            </Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={formData.eduUndergradYear}
              onChange={(e) => onChange({ eduUndergradYear: e.target.value })}
            >
              <option value="">Select year</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            {errors.eduUndergradYear && (
              <p className="text-xs text-destructive mt-1">{errors.eduUndergradYear}</p>
            )}
          </div>
        </div>
      </div>

      {type?.requiresPG && (
        <div className="border rounded-lg p-4 space-y-4">
          <h4 className="font-medium">
            Postgraduate <span className="text-destructive">*</span>
          </h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Degree <span className="text-destructive">*</span></Label>
              <Input
                value={formData.eduPostgradDegree}
                onChange={(e) => onChange({ eduPostgradDegree: e.target.value })}
                placeholder="e.g., MS General Surgery, MCh, DNB"
              />
              {errors.eduPostgradDegree && (
                <p className="text-xs text-destructive mt-1">{errors.eduPostgradDegree}</p>
              )}
            </div>
            <div>
              <Label>College <span className="text-destructive">*</span></Label>
              <Input
                value={formData.eduPostgradCollege}
                onChange={(e) => onChange({ eduPostgradCollege: e.target.value })}
                placeholder="College name"
              />
              {errors.eduPostgradCollege && (
                <p className="text-xs text-destructive mt-1">{errors.eduPostgradCollege}</p>
              )}
            </div>
            <div>
              <Label>University <span className="text-destructive">*</span></Label>
              <Input
                value={formData.eduPostgradUniversity}
                onChange={(e) => onChange({ eduPostgradUniversity: e.target.value })}
                placeholder="University name"
              />
              {errors.eduPostgradUniversity && (
                <p className="text-xs text-destructive mt-1">{errors.eduPostgradUniversity}</p>
              )}
            </div>
            <div>
              <Label>Year of Passing <span className="text-destructive">*</span></Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.eduPostgradYear}
                onChange={(e) => onChange({ eduPostgradYear: e.target.value })}
              >
                <option value="">Select year</option>
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              {errors.eduPostgradYear && (
                <p className="text-xs text-destructive mt-1">{errors.eduPostgradYear}</p>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="border rounded-lg p-4 space-y-4">
        <h4 className="font-medium">Super Specialty (Optional)</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Degree</Label>
            <Input
              value={formData.eduSuperspecialtyDegree}
              onChange={(e) => onChange({ eduSuperspecialtyDegree: e.target.value })}
              placeholder="e.g., MCh, DM"
            />
          </div>
          <div>
            <Label>College</Label>
            <Input
              value={formData.eduSuperspecialtyCollege}
              onChange={(e) => onChange({ eduSuperspecialtyCollege: e.target.value })}
              placeholder="College name"
            />
          </div>
          <div>
            <Label>University</Label>
            <Input
              value={formData.eduSuperspecialtyUniversity}
              onChange={(e) => onChange({ eduSuperspecialtyUniversity: e.target.value })}
              placeholder="University name"
            />
          </div>
          <div>
            <Label>Year</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={formData.eduSuperspecialtyYear}
              onChange={(e) => onChange({ eduSuperspecialtyYear: e.target.value })}
            >
              <option value="">Select year</option>
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
