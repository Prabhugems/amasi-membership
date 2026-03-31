"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { INDIAN_STATES, STATE_TO_ZONE } from "@/lib/membership-types"
import type { ApplicationFormData } from "@/lib/membership-types"

interface StepPersonalProps {
  formData: ApplicationFormData
  onChange: (data: Partial<ApplicationFormData>) => void
  errors: Record<string, string>
}

export function StepPersonal({ formData, onChange, errors }: StepPersonalProps) {
  const handleStateChange = (state: string) => {
    onChange({
      state,
      zone: STATE_TO_ZONE[state] || "",
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Personal Details</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your personal information as it appears on your medical documents
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div>
          <Label>Salutation</Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={formData.salutation}
            onChange={(e) => onChange({ salutation: e.target.value })}
          >
            <option value="Dr.">Dr.</option>
            <option value="Prof.">Prof.</option>
            <option value="Mr.">Mr.</option>
            <option value="Mrs.">Mrs.</option>
            <option value="Ms.">Ms.</option>
          </select>
        </div>
        <div>
          <Label>First Name <span className="text-destructive">*</span></Label>
          <Input
            value={formData.firstName}
            onChange={(e) => onChange({ firstName: e.target.value })}
            placeholder="First name"
          />
          {errors.firstName && <p className="text-xs text-destructive mt-1">{errors.firstName}</p>}
        </div>
        <div>
          <Label>Middle Name</Label>
          <Input
            value={formData.middleName}
            onChange={(e) => onChange({ middleName: e.target.value })}
            placeholder="Middle name"
          />
        </div>
        <div>
          <Label>Last Name</Label>
          <Input
            value={formData.lastName}
            onChange={(e) => onChange({ lastName: e.target.value })}
            placeholder="Last name"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label>Date of Birth <span className="text-destructive">*</span></Label>
          <Input
            type="date"
            value={formData.dob}
            onChange={(e) => onChange({ dob: e.target.value })}
          />
          {errors.dob && <p className="text-xs text-destructive mt-1">{errors.dob}</p>}
        </div>
        <div>
          <Label>Gender <span className="text-destructive">*</span></Label>
          <select
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={formData.gender}
            onChange={(e) => onChange({ gender: e.target.value })}
          >
            <option value="">Select gender</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
          {errors.gender && <p className="text-xs text-destructive mt-1">{errors.gender}</p>}
        </div>
        <div>
          <Label>Father&apos;s Name</Label>
          <Input
            value={formData.fatherName}
            onChange={(e) => onChange({ fatherName: e.target.value })}
            placeholder="Father's name"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Email <span className="text-destructive">*</span></Label>
          <Input
            type="email"
            value={formData.email}
            onChange={(e) => onChange({ email: e.target.value })}
            placeholder="doctor@example.com"
          />
          {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
        </div>
        <div>
          <Label>Mobile Number <span className="text-destructive">*</span></Label>
          <div className="flex gap-2">
            <Input
              className="w-20"
              value={formData.mobileCode}
              onChange={(e) => onChange({ mobileCode: e.target.value })}
            />
            <Input
              className="flex-1"
              value={formData.mobile}
              onChange={(e) => onChange({ mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              placeholder="10-digit mobile number"
            />
          </div>
          {errors.mobile && <p className="text-xs text-destructive mt-1">{errors.mobile}</p>}
        </div>
      </div>

      <div className="border-t pt-4">
        <h4 className="font-medium mb-3">Address</h4>
        <div className="grid gap-4">
          <div>
            <Label>Street Line 1 <span className="text-destructive">*</span></Label>
            <Input
              value={formData.streetLine1}
              onChange={(e) => onChange({ streetLine1: e.target.value })}
              placeholder="House/Building, Street"
            />
            {errors.streetLine1 && <p className="text-xs text-destructive mt-1">{errors.streetLine1}</p>}
          </div>
          <div>
            <Label>Street Line 2</Label>
            <Input
              value={formData.streetLine2}
              onChange={(e) => onChange({ streetLine2: e.target.value })}
              placeholder="Area, Landmark"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label>City <span className="text-destructive">*</span></Label>
              <Input
                value={formData.city}
                onChange={(e) => onChange({ city: e.target.value })}
                placeholder="City"
              />
              {errors.city && <p className="text-xs text-destructive mt-1">{errors.city}</p>}
            </div>
            <div>
              <Label>State <span className="text-destructive">*</span></Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={formData.state}
                onChange={(e) => handleStateChange(e.target.value)}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((state) => (
                  <option key={state} value={state}>{state}</option>
                ))}
              </select>
              {errors.state && <p className="text-xs text-destructive mt-1">{errors.state}</p>}
            </div>
            <div>
              <Label>PIN Code <span className="text-destructive">*</span></Label>
              <Input
                value={formData.pin}
                onChange={(e) => onChange({ pin: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                placeholder="6-digit PIN"
              />
              {errors.pin && <p className="text-xs text-destructive mt-1">{errors.pin}</p>}
            </div>
            <div>
              <Label>Zone</Label>
              <Input value={formData.zone} disabled className="bg-muted" />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
