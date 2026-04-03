"use client"

import { ArrowRight, ArrowLeft, CheckCircle2, Save } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { ChangeEntry } from "@/lib/profile-mapper"

interface ProfileReviewProps {
  changes: ChangeEntry[]
  onConfirm: () => void
  onBack: () => void
  isSaving: boolean
}

export function ProfileReview({ changes, onConfirm, onBack, isSaving }: ProfileReviewProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Review Changes</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Please confirm the following updates to your profile</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <span className="flex items-center justify-center h-7 w-7 rounded-full bg-primary/10 text-primary text-sm font-bold">
              {changes.length}
            </span>
            <span>field{changes.length !== 1 ? "s" : ""} changed</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {changes.map((change) => (
              <div key={change.field} className="py-3.5 first:pt-0 last:pb-0">
                <p className="text-sm font-semibold mb-1.5">{change.label}</p>
                {change.field === "profile_photo" ? (
                  <div className="flex items-center gap-3">
                    <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground overflow-hidden border">
                      {change.oldValue ? <img src={change.oldValue} alt="Old" className="h-full w-full object-cover" /> : "No photo"}
                    </div>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <div className="h-14 w-14 rounded-full bg-primary/5 flex items-center justify-center overflow-hidden border-2 border-primary/30">
                      {change.newValue ? <img src={change.newValue} alt="New" className="h-full w-full object-cover" /> : "No photo"}
                    </div>
                    <span className="text-xs text-green-600 font-medium">New photo uploaded</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-muted-foreground line-through bg-muted/50 px-2 py-0.5 rounded text-xs max-w-[200px] truncate">
                      {change.oldValue || <em>empty</em>}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="font-medium text-primary bg-primary/5 px-2 py-0.5 rounded text-xs max-w-[200px] truncate">
                      {change.newValue || <em>empty</em>}
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack} disabled={isSaving} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Edit
        </Button>
        <Button onClick={onConfirm} disabled={isSaving} size="lg" className="gap-2 font-semibold">
          {isSaving ? (
            <>
              <span className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Confirm & Save
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
