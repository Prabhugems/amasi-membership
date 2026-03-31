"use client"

import { MEMBERSHIP_TYPES, calculateFee } from "@/lib/membership-types"
import type { ApplicationFormData } from "@/lib/membership-types"
import { cn } from "@/lib/utils"
import { Check, Crown, GraduationCap, Globe, Users } from "lucide-react"

const ICONS: Record<string, React.ElementType> = {
  LM: Crown,
  ALM: Users,
  ACM: GraduationCap,
  ILM: Globe,
}

interface StepTypeSelectProps {
  formData: ApplicationFormData
  onChange: (data: Partial<ApplicationFormData>) => void
}

export function StepTypeSelect({ formData, onChange }: StepTypeSelectProps) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold">Select Membership Type</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Choose the membership category that best fits your qualifications
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {MEMBERSHIP_TYPES.map((type) => {
          const Icon = ICONS[type.id] || Users
          const fee = calculateFee(type)
          const isSelected = formData.membershipType === type.id

          return (
            <button
              key={type.id}
              type="button"
              onClick={() => onChange({ membershipType: type.id })}
              className={cn(
                "relative rounded-xl border-2 p-5 text-left transition-all hover:shadow-md",
                isSelected
                  ? "border-primary bg-primary/5 shadow-md"
                  : "border-input hover:border-primary/30"
              )}
            >
              {isSelected && (
                <div className="absolute top-3 right-3 h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                  <Check className="h-4 w-4 text-primary-foreground" />
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className={cn(
                  "h-10 w-10 rounded-lg flex items-center justify-center",
                  isSelected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1">
                  <h4 className="font-semibold">{type.name}</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">{type.shortName}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-3">{type.description}</p>
              <div className="mt-3 pt-3 border-t">
                <p className="text-xs text-muted-foreground">{type.eligibility}</p>
                <p className="text-sm font-semibold mt-2">
                  {fee.currency}{fee.totalFee.toLocaleString()}
                  <span className="text-xs font-normal text-muted-foreground ml-1">
                    (incl. {type.processingFeePercent}% processing)
                  </span>
                </p>
              </div>
              {type.votingRights && (
                <div className="mt-2">
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    Voting Rights
                  </span>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
