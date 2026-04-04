"use client"

import { ArrowRight, ArrowLeft, CheckCircle2, Save, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { ChangeEntry } from "@/lib/profile-mapper"

interface ProfileReviewProps {
  changes: ChangeEntry[]
  onConfirm: () => void
  onBack: () => void
  isSaving: boolean
}

export function ProfileReview({ changes, onConfirm, onBack, isSaving }: ProfileReviewProps) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Review Changes</h2>
        <p className="text-sm text-muted-foreground mt-0.5">Please confirm the following updates to your profile</p>
      </div>

      {/* Summary badge */}
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="text-sm py-1 px-3 gap-2 border-teal-200 bg-teal-50 text-teal-700">
          <AlertCircle className="h-3.5 w-3.5" />
          {changes.length} field{changes.length !== 1 ? "s" : ""} will be updated
        </Badge>
      </div>

      {/* Diff table */}
      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-base">Change Details</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {/* Photo changes first */}
          {changes.filter(c => c.field === "profile_photo").map((change) => (
            <div key={change.field} className="flex items-center gap-4 pb-5 mb-5 border-b">
              <p className="text-sm font-semibold w-36 shrink-0">{change.label}</p>
              <div className="flex items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-red-50 border-2 border-red-200 flex items-center justify-center overflow-hidden">
                  {change.oldValue ? <img src={change.oldValue} alt="Old" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">None</span>}
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="h-16 w-16 rounded-full bg-green-50 border-2 border-green-300 flex items-center justify-center overflow-hidden">
                  {change.newValue ? <img src={change.newValue} alt="New" className="h-full w-full object-cover" /> : <span className="text-xs text-muted-foreground">None</span>}
                </div>
              </div>
            </div>
          ))}

          {/* Table for non-photo changes */}
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50">
                  <th className="text-left py-3 px-4 font-semibold text-muted-foreground text-xs uppercase tracking-wide w-1/4">Field</th>
                  <th className="text-left py-3 px-4 font-semibold text-xs uppercase tracking-wide w-[37.5%]">
                    <span className="text-red-600">Old Value</span>
                  </th>
                  <th className="px-2 w-6" />
                  <th className="text-left py-3 px-4 font-semibold text-xs uppercase tracking-wide w-[37.5%]">
                    <span className="text-green-600">New Value</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {changes.filter(c => c.field !== "profile_photo").map((change) => (
                  <tr key={change.field} className="group hover:bg-muted/30 transition-colors">
                    <td className="py-3 px-4 font-medium text-foreground">{change.label}</td>
                    <td className="py-3 px-4">
                      <span className="inline-block bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 rounded-md text-sm max-w-[220px] truncate">
                        {change.oldValue || <em className="text-red-400 not-italic">empty</em>}
                      </span>
                    </td>
                    <td className="px-1 text-center">
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground inline-block" />
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-block bg-green-50 text-green-700 border border-green-200 px-2.5 py-1 rounded-md text-sm font-medium max-w-[220px] truncate">
                        {change.newValue || <em className="text-green-400 not-italic">empty</em>}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
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
