"use client"

import { useState } from "react"
import { Loader2, MapPin, CheckCircle2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { INDIAN_STATES, STATE_TO_ZONE } from "@/lib/membership-types"
import type { ApplicationFormData } from "@/lib/membership-types"

interface StepPersonalProps {
  formData: ApplicationFormData
  onChange: (data: Partial<ApplicationFormData>) => void
  errors: Record<string, string>
  emailVerified?: boolean
}

export function StepPersonal({ formData, onChange, errors, emailVerified }: StepPersonalProps) {
  const [pinLoading, setPinLoading] = useState(false)
  const [pinResolved, setPinResolved] = useState(false)

  const handleStateChange = (state: string) => {
    onChange({
      state,
      zone: STATE_TO_ZONE[state] || "",
    })
  }

  const handlePinChange = async (pin: string) => {
    const cleaned = pin.replace(/\D/g, "").slice(0, 6)
    onChange({ pin: cleaned })
    setPinResolved(false)

    if (cleaned.length === 6) {
      setPinLoading(true)
      try {
        const res = await fetch(`/api/pincode?pin=${cleaned}`)
        const data = await res.json()
        if (data.status) {
          const updates: Partial<ApplicationFormData> = { pin: cleaned }
          if (data.city) updates.city = data.city
          if (data.state) {
            const matched = INDIAN_STATES.find(s => s.toLowerCase() === data.state.toLowerCase())
            if (matched) {
              updates.state = matched
              updates.zone = STATE_TO_ZONE[matched] || ""
            }
          }
          onChange(updates)
          setPinResolved(true)
        }
      } catch { /* ignore */ }
      setPinLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Personal Details</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Fields marked * are required. Address can be updated later from your profile.
        </p>
      </div>

      {/* Name row */}
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

      {/* DOB + Gender + Father */}
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
          <div className="flex gap-2 mt-1">
            {["Male", "Female", "Other"].map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => onChange({ gender: g })}
                className={`flex-1 h-10 rounded-md border text-sm font-medium transition-colors ${
                  formData.gender === g
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-accent"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
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

      {/* Email + Mobile - verified = read-only */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Email <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Input
              type="email"
              value={formData.email}
              onChange={(e) => onChange({ email: e.target.value })}
              placeholder="doctor@example.com"
              readOnly={emailVerified}
              className={emailVerified ? "bg-muted pr-24" : ""}
            />
            {emailVerified && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-medium text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> Verified
              </span>
            )}
          </div>
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
              className={emailVerified ? "flex-1 bg-muted" : "flex-1"}
              value={formData.mobile}
              onChange={(e) => onChange({ mobile: e.target.value.replace(/\D/g, "").slice(0, 10) })}
              placeholder="10-digit mobile number"
              readOnly={emailVerified}
            />
          </div>
          {errors.mobile && <p className="text-xs text-destructive mt-1">{errors.mobile}</p>}
        </div>
      </div>

      {/* Address - start with PIN code */}
      <div className="border-t pt-4">
        <h4 className="font-medium mb-1">Address</h4>
        <p className="text-xs text-muted-foreground mb-3">Enter your PIN code to auto-fill city and state</p>

        <div className="grid gap-4 sm:grid-cols-4">
          <div>
            <Label>PIN Code</Label>
            <div className="relative">
              <Input
                value={formData.pin}
                onChange={(e) => handlePinChange(e.target.value)}
                placeholder="6-digit PIN"
                maxLength={6}
              />
              {pinLoading && <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
              {pinResolved && <MapPin className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />}
            </div>
            {errors.pin && <p className="text-xs text-destructive mt-1">{errors.pin}</p>}
          </div>
          <div>
            <Label>City</Label>
            <Input
              value={formData.city}
              onChange={(e) => onChange({ city: e.target.value })}
              placeholder="City"
            />
            {errors.city && <p className="text-xs text-destructive mt-1">{errors.city}</p>}
          </div>
          <div>
            <Label>State</Label>
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
            <Label>Zone</Label>
            <Input value={formData.zone} disabled className="bg-muted" />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 mt-4">
          <div>
            <Label>Street Line 1</Label>
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
        </div>
      </div>
    </div>
  )
}
