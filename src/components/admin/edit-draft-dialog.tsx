"use client"

// Edit Draft Fields dialog — Phase 4a of admin recovery tooling.
// Super_admin-only form covering the 9-field allowlist locked in with
// the architect 2026-05-25: identity (salutation, first/middle/last
// name, dob), contact (mobileCode, mobile), registration
// (mciCouncilNumber, mciCouncilState). Submits only the fields that
// actually changed; server-side audit-logs the per-field delta.
//
// Why a separate component instead of extending ConfirmDialog: this
// dialog carries form state (9 inputs, dirty tracking, validation),
// while ConfirmDialog is intentionally state-free. Phase 2's
// orphan-payment confirm can still reuse ConfirmDialog via its
// children slot.

import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// 9-field allowlist. Order here drives the visual order in the form.
const FIELDS = [
  "salutation",
  "firstName",
  "middleName",
  "lastName",
  "dob",
  "mobileCode",
  "mobile",
  "mciCouncilNumber",
  "mciCouncilState",
] as const
type EditableField = (typeof FIELDS)[number]

interface EditDraftDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  draftId: string | null
  // Subset of step_data.formData that we read for pre-population. Anything
  // beyond the 9 allowlisted keys is ignored; missing keys default to empty.
  initialValues: Partial<Record<EditableField, string | null | undefined>>
  // Display name shown in the dialog title. Falls back to the email in the
  // page-level helper.
  displayName: string
  onSaved: (updated: Record<string, unknown>) => void
}

function fieldLabel(key: EditableField): string {
  switch (key) {
    case "salutation": return "Salutation"
    case "firstName": return "First name"
    case "middleName": return "Middle name"
    case "lastName": return "Last name"
    case "dob": return "Date of birth"
    case "mobileCode": return "Country code"
    case "mobile": return "Mobile number"
    case "mciCouncilNumber": return "MCI / State council number"
    case "mciCouncilState": return "State medical council"
  }
}

function fieldType(key: EditableField): "text" | "date" {
  return key === "dob" ? "date" : "text"
}

function fieldPlaceholder(key: EditableField): string | undefined {
  switch (key) {
    case "salutation": return "Dr."
    case "mobileCode": return "+91"
    case "mobile": return "9888262460"
    case "mciCouncilNumber": return "e.g. HN-014612"
    case "mciCouncilState": return "e.g. Goa, Maharashtra"
    default: return undefined
  }
}

export function EditDraftDialog({
  open,
  onOpenChange,
  draftId,
  initialValues,
  displayName,
  onSaved,
}: EditDraftDialogProps) {
  // Form state. Each key is always a string in local state — empty string
  // represents "cleared." On submit, we coerce "" back to the original
  // value if it was already empty (no diff) or pass it through as a clear.
  //
  // Re-initialization across drafts: the parent passes `key={draft.id}`
  // on this component, so changing the selected draft remounts the
  // dialog with fresh initial state. No useEffect needed — avoids the
  // setState-in-effect warning and is the React-idiomatic way to
  // reset state on identity change.
  const [values, setValues] = useState<Record<EditableField, string>>(() => {
    const out = {} as Record<EditableField, string>
    for (const k of FIELDS) {
      const v = initialValues[k]
      out[k] = typeof v === "string" ? v : ""
    }
    return out
  })
  const [isPending, setIsPending] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Dirty check — at least one field differs from the initial values.
  // Whitespace-trimmed compare to match the server's coercion.
  const isDirty = FIELDS.some((k) => {
    const orig = typeof initialValues[k] === "string" ? (initialValues[k] as string) : ""
    return values[k].trim() !== orig.trim()
  })

  const handleSave = async () => {
    if (!draftId) return
    setIsPending(true)
    setErrorMsg(null)

    // Build the changed-only payload. Server also de-dupes server-side,
    // but trimming client-side avoids round-tripping no-op fields.
    const fields: Record<string, string | null> = {}
    for (const k of FIELDS) {
      const orig = typeof initialValues[k] === "string" ? (initialValues[k] as string) : ""
      const next = values[k].trim()
      if (next === orig.trim()) continue
      // Empty string sent as null so the server treats it as "cleared."
      fields[k] = next === "" ? null : next
    }

    try {
      const res = await fetch(`/api/admin/drafts/${draftId}/edit-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        updated?: Record<string, unknown>
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to save edits")
      }
      onSaved(data.updated || {})
      onOpenChange(false)
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "Failed to save edits")
    } finally {
      setIsPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Draft — {displayName}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2">
          Every change is audit-logged. Email, membership type, uploads, and payment
          fields are intentionally not editable here.
        </p>

        <div className="space-y-5 pt-2">
          <Section title="Identity">
            <FormField
              field="salutation"
              value={values.salutation}
              onChange={(v) => setValues((s) => ({ ...s, salutation: v }))}
            />
            <FormField
              field="firstName"
              value={values.firstName}
              onChange={(v) => setValues((s) => ({ ...s, firstName: v }))}
            />
            <FormField
              field="middleName"
              value={values.middleName}
              onChange={(v) => setValues((s) => ({ ...s, middleName: v }))}
            />
            <FormField
              field="lastName"
              value={values.lastName}
              onChange={(v) => setValues((s) => ({ ...s, lastName: v }))}
            />
            <FormField
              field="dob"
              value={values.dob}
              onChange={(v) => setValues((s) => ({ ...s, dob: v }))}
            />
          </Section>

          <Section title="Contact">
            <FormField
              field="mobileCode"
              value={values.mobileCode}
              onChange={(v) => setValues((s) => ({ ...s, mobileCode: v }))}
            />
            <FormField
              field="mobile"
              value={values.mobile}
              onChange={(v) => setValues((s) => ({ ...s, mobile: v }))}
            />
          </Section>

          <Section title="Registration">
            <FormField
              field="mciCouncilNumber"
              value={values.mciCouncilNumber}
              onChange={(v) => setValues((s) => ({ ...s, mciCouncilNumber: v }))}
            />
            <FormField
              field="mciCouncilState"
              value={values.mciCouncilState}
              onChange={(v) => setValues((s) => ({ ...s, mciCouncilState: v }))}
            />
          </Section>
        </div>

        {errorMsg && (
          <p className="text-sm text-red-600 dark:text-red-400 pt-1">{errorMsg}</p>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={isPending || !isDirty}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        {title}
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{children}</div>
    </div>
  )
}

function FormField({
  field,
  value,
  onChange,
}: {
  field: EditableField
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`edit-${field}`} className="text-xs font-medium">
        {fieldLabel(field)}
      </Label>
      <Input
        id={`edit-${field}`}
        type={fieldType(field)}
        value={value}
        placeholder={fieldPlaceholder(field)}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 text-sm"
      />
    </div>
  )
}
