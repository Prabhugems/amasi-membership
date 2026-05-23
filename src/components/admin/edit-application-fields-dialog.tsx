"use client"

import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Lock, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { INDIAN_STATES } from "@/lib/membership-types"

// Visual reference:
//   design-references/tailwind-plus/drawer-wide-create-project-form.tsx
//     (outer shell — right-anchored panel, sticky header, sticky footer)
//   design-references/tailwind-plus/form-layout-stacked-sections.tsx
//     (body — section headings + sm:grid-cols-6 field grid)
// Adaptations per AGENTS.md §2:
//   - Headless UI <Dialog>/<DialogPanel> replaced with the project's Radix
//     <Dialog>/<DialogContent> from @/components/ui/dialog.
//   - Heroicons replaced with lucide-react (Lock, Save, Loader2). The X close
//     button is provided automatically by <DialogContent>.
//   - Hardcoded palette (bg-gray-800, text-white, outline-white/10, indigo)
//     mapped to theme tokens (bg-card, text-foreground, border-border, etc).
//   - One sticky footer at the bottom (drawer's pattern), not the form-layout
//     block's per-section Save buttons.
//
// Email and phone are rendered read-only with a Lock icon + tooltip — they are
// the OTP/login identity for resume + member-portal access; changing them
// silently could leave an applicant unable to log back in. Locked field
// rejection is enforced server-side in /api/applications/[id]/edit-fields.

// Mirrors EDITABLE_APPLICATION_FIELDS in src/lib/edit-application-fields.ts.
// `zone` is intentionally absent — it's derived server-side from `state`.
const EDITABLE_KEYS = [
  "salutation",
  "first_name",
  "middle_name",
  "last_name",
  "father_name",
  "date_of_birth",
  "gender",
  "nationality",
  "street_address_1",
  "street_address_2",
  "city",
  "state",
  "postal_code",
  "country",
  "clinic_name",
  "clinic_street_address_1",
  "clinic_street_address_2",
  "clinic_city",
  "clinic_state",
  "clinic_postal_code",
  "clinic_country",
  "landline",
  "std_code",
  "ug_degree",
  "ug_college",
  "ug_university",
  "ug_year",
  "pg_degree",
  "pg_college",
  "pg_university",
  "pg_year",
  "ss_degree",
  "ss_college",
  "ss_university",
  "ss_year",
  "mci_council_number",
  "mci_council_state",
  "imr_registration_no",
  "asi_membership_no",
  "asi_state",
] as const

type EditableKey = (typeof EDITABLE_KEYS)[number]
type FormState = Record<EditableKey, string>

function toFormState(app: Record<string, unknown> | null): FormState {
  const out = {} as FormState
  for (const key of EDITABLE_KEYS) {
    const value = app?.[key]
    out[key] =
      value === null || value === undefined ? "" : String(value)
  }
  return out
}

interface EditApplicationFieldsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  app: Record<string, unknown> | null
  onSaved: () => void
}

export function EditApplicationFieldsDialog({
  open,
  onOpenChange,
  app,
  onSaved,
}: EditApplicationFieldsDialogProps) {
  const initial = useMemo(() => toFormState(app), [app])
  // Reset form when the application being edited changes. Uses the
  // render-time setState pattern (React 18+) instead of useEffect to
  // avoid the cascading-render anti-pattern flagged by
  // react-hooks/set-state-in-effect.
  const [form, setForm] = useState<FormState>(initial)
  const [lastAppId, setLastAppId] = useState<string | null>(
    (app?.id as string) ?? null,
  )
  const currentAppId = (app?.id as string) ?? null
  if (currentAppId !== lastAppId) {
    setLastAppId(currentAppId)
    setForm(initial)
  }

  const appId = (app?.id as string) || ""
  const fullName =
    [app?.first_name, app?.middle_name, app?.last_name]
      .filter(Boolean)
      .join(" ") || (app?.name as string) || "Applicant"
  const referenceNumber = (app?.reference_number as string) || ""
  const lockedEmail = (app?.email as string) || ""
  const lockedPhone = [
    (app?.mobile_code as string) || "",
    (app?.phone as string) || "",
  ]
    .filter(Boolean)
    .join(" ")
  const currentZone = (app?.zone as string) || ""

  const mutation = useMutation({
    mutationFn: async (updates: Record<string, string | null>) => {
      const res = await fetch(`/api/applications/${appId}/edit-fields`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(json?.message || "Failed to update application")
      }
      return json
    },
    onSuccess: (data) => {
      const changed = (data?.changed ?? 0) as number
      if (changed === 0) {
        toast.message("No changes to save")
      } else {
        toast.success(`Saved ${changed} field${changed === 1 ? "" : "s"}`)
      }
      onSaved()
      onOpenChange(false)
    },
    onError: (err) => {
      toast.error((err as Error)?.message || "Failed to update application")
    },
  })

  function setField(key: EditableKey, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function diff(): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    for (const key of EDITABLE_KEYS) {
      const before = (initial[key] ?? "").trim()
      const after = (form[key] ?? "").trim()
      if (before !== after) {
        out[key] = after === "" ? null : after
      }
    }
    return out
  }

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const updates = diff()
    if (Object.keys(updates).length === 0) {
      toast.message("No changes to save")
      return
    }
    mutation.mutate(updates)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="left-auto right-0 top-0 bottom-0 inset-y-0 h-screen max-h-screen w-screen max-w-2xl translate-x-0 translate-y-0 rounded-none sm:rounded-none border-y-0 border-r-0 border-l p-0 overflow-hidden gap-0"
        aria-describedby="edit-fields-description"
      >
        <div className="flex h-screen flex-col">
          {/* Header — sticky-shaped: outside the scrollable body */}
          <div className="shrink-0 bg-muted/30 px-4 py-6 sm:px-6 border-b">
            <div className="flex items-start justify-between gap-3 pr-8">
              <div className="space-y-1">
                <DialogTitle className="text-base font-semibold text-foreground">
                  Edit application details
                </DialogTitle>
                <DialogDescription
                  id="edit-fields-description"
                  className="text-sm text-muted-foreground"
                >
                  {fullName}
                  {referenceNumber && (
                    <span className="ml-2 font-mono text-xs">
                      {referenceNumber}
                    </span>
                  )}
                </DialogDescription>
              </div>
            </div>
          </div>

          {/* Body — scrollable */}
          <form
            className="flex-1 overflow-y-auto"
            onSubmit={onSubmit}
            id="edit-application-fields-form"
          >
            <div className="divide-y divide-border">
              {/* Identity (locked) */}
              <Section
                title="Identity"
                description="Email and phone are the OTP/login identity. Contact engineering to change them."
              >
                <LockedField label="Email" value={lockedEmail} wide />
                <LockedField label="Phone" value={lockedPhone} wide />
              </Section>

              {/* Personal Details */}
              <Section title="Personal Details">
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-salutation">Salutation</FieldLabel>
                  <FieldInput
                    id="ef-salutation"
                    value={form.salutation}
                    onChange={(e) => setField("salutation", e.target.value)}
                    maxLength={16}
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-first-name">First name</FieldLabel>
                  <FieldInput
                    id="ef-first-name"
                    value={form.first_name}
                    onChange={(e) => setField("first_name", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-middle-name">Middle name</FieldLabel>
                  <FieldInput
                    id="ef-middle-name"
                    value={form.middle_name}
                    onChange={(e) => setField("middle_name", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-last-name">Last name</FieldLabel>
                  <FieldInput
                    id="ef-last-name"
                    value={form.last_name}
                    onChange={(e) => setField("last_name", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-father-name">Father&apos;s name</FieldLabel>
                  <FieldInput
                    id="ef-father-name"
                    value={form.father_name}
                    onChange={(e) => setField("father_name", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-dob">Date of birth</FieldLabel>
                  <FieldInput
                    id="ef-dob"
                    type="date"
                    value={form.date_of_birth}
                    onChange={(e) =>
                      setField("date_of_birth", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-gender">Gender</FieldLabel>
                  <FieldSelect
                    id="ef-gender"
                    value={form.gender}
                    onChange={(e) => setField("gender", e.target.value)}
                  >
                    <option value="">—</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </FieldSelect>
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-nationality">Nationality</FieldLabel>
                  <FieldInput
                    id="ef-nationality"
                    value={form.nationality}
                    onChange={(e) => setField("nationality", e.target.value)}
                  />
                </FieldCell>
              </Section>

              {/* Home Address */}
              <Section title="Home Address">
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-street-1">Street address line 1</FieldLabel>
                  <FieldInput
                    id="ef-street-1"
                    value={form.street_address_1}
                    onChange={(e) =>
                      setField("street_address_1", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-street-2">Street address line 2</FieldLabel>
                  <FieldInput
                    id="ef-street-2"
                    value={form.street_address_2}
                    onChange={(e) =>
                      setField("street_address_2", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-city">City</FieldLabel>
                  <FieldInput
                    id="ef-city"
                    value={form.city}
                    onChange={(e) => setField("city", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-state">State</FieldLabel>
                  <FieldSelect
                    id="ef-state"
                    value={form.state}
                    onChange={(e) => setField("state", e.target.value)}
                  >
                    <option value="">—</option>
                    {INDIAN_STATES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </FieldSelect>
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-postal">Postal code</FieldLabel>
                  <FieldInput
                    id="ef-postal"
                    value={form.postal_code}
                    onChange={(e) => setField("postal_code", e.target.value)}
                    maxLength={16}
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-country">Country</FieldLabel>
                  <FieldInput
                    id="ef-country"
                    value={form.country}
                    onChange={(e) => setField("country", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel>Zone (derived)</FieldLabel>
                  <div
                    title="Derived from State — updated automatically when State changes"
                    className="flex items-center gap-2 rounded-md border border-input bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                  >
                    <Lock className="h-3 w-3" />
                    {currentZone || "—"}
                  </div>
                </FieldCell>
              </Section>

              {/* Clinic / Work Address */}
              <Section title="Clinic / Work Address">
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-clinic-name">Clinic name</FieldLabel>
                  <FieldInput
                    id="ef-clinic-name"
                    value={form.clinic_name}
                    onChange={(e) => setField("clinic_name", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-clinic-street-1">Street address line 1</FieldLabel>
                  <FieldInput
                    id="ef-clinic-street-1"
                    value={form.clinic_street_address_1}
                    onChange={(e) =>
                      setField("clinic_street_address_1", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-clinic-street-2">Street address line 2</FieldLabel>
                  <FieldInput
                    id="ef-clinic-street-2"
                    value={form.clinic_street_address_2}
                    onChange={(e) =>
                      setField("clinic_street_address_2", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-clinic-city">City</FieldLabel>
                  <FieldInput
                    id="ef-clinic-city"
                    value={form.clinic_city}
                    onChange={(e) =>
                      setField("clinic_city", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-clinic-state">State</FieldLabel>
                  <FieldInput
                    id="ef-clinic-state"
                    value={form.clinic_state}
                    onChange={(e) =>
                      setField("clinic_state", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-clinic-postal">Postal code</FieldLabel>
                  <FieldInput
                    id="ef-clinic-postal"
                    value={form.clinic_postal_code}
                    onChange={(e) =>
                      setField("clinic_postal_code", e.target.value)
                    }
                    maxLength={16}
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-clinic-country">Country</FieldLabel>
                  <FieldInput
                    id="ef-clinic-country"
                    value={form.clinic_country}
                    onChange={(e) =>
                      setField("clinic_country", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-std">STD code</FieldLabel>
                  <FieldInput
                    id="ef-std"
                    value={form.std_code}
                    onChange={(e) => setField("std_code", e.target.value)}
                    maxLength={8}
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-landline">Landline</FieldLabel>
                  <FieldInput
                    id="ef-landline"
                    value={form.landline}
                    onChange={(e) => setField("landline", e.target.value)}
                  />
                </FieldCell>
              </Section>

              {/* Education — Undergraduate */}
              <Section title="Education — Undergraduate (MBBS)">
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-ug-degree">Degree</FieldLabel>
                  <FieldInput
                    id="ef-ug-degree"
                    value={form.ug_degree}
                    onChange={(e) => setField("ug_degree", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-ug-college">College</FieldLabel>
                  <FieldInput
                    id="ef-ug-college"
                    value={form.ug_college}
                    onChange={(e) => setField("ug_college", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={4}>
                  <FieldLabel htmlFor="ef-ug-university">University</FieldLabel>
                  <FieldInput
                    id="ef-ug-university"
                    value={form.ug_university}
                    onChange={(e) =>
                      setField("ug_university", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-ug-year">Year</FieldLabel>
                  <FieldInput
                    id="ef-ug-year"
                    value={form.ug_year}
                    onChange={(e) => setField("ug_year", e.target.value)}
                    maxLength={4}
                  />
                </FieldCell>
              </Section>

              {/* Education — Postgraduate */}
              <Section title="Education — Postgraduate">
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-pg-degree">Degree</FieldLabel>
                  <FieldInput
                    id="ef-pg-degree"
                    value={form.pg_degree}
                    onChange={(e) => setField("pg_degree", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-pg-college">College</FieldLabel>
                  <FieldInput
                    id="ef-pg-college"
                    value={form.pg_college}
                    onChange={(e) => setField("pg_college", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={4}>
                  <FieldLabel htmlFor="ef-pg-university">University</FieldLabel>
                  <FieldInput
                    id="ef-pg-university"
                    value={form.pg_university}
                    onChange={(e) =>
                      setField("pg_university", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-pg-year">Year</FieldLabel>
                  <FieldInput
                    id="ef-pg-year"
                    value={form.pg_year}
                    onChange={(e) => setField("pg_year", e.target.value)}
                    maxLength={4}
                  />
                </FieldCell>
              </Section>

              {/* Education — Super Specialty */}
              <Section title="Education — Super Specialty">
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-ss-degree">Degree</FieldLabel>
                  <FieldInput
                    id="ef-ss-degree"
                    value={form.ss_degree}
                    onChange={(e) => setField("ss_degree", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span="full">
                  <FieldLabel htmlFor="ef-ss-college">College</FieldLabel>
                  <FieldInput
                    id="ef-ss-college"
                    value={form.ss_college}
                    onChange={(e) => setField("ss_college", e.target.value)}
                  />
                </FieldCell>
                <FieldCell span={4}>
                  <FieldLabel htmlFor="ef-ss-university">University</FieldLabel>
                  <FieldInput
                    id="ef-ss-university"
                    value={form.ss_university}
                    onChange={(e) =>
                      setField("ss_university", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={2}>
                  <FieldLabel htmlFor="ef-ss-year">Year</FieldLabel>
                  <FieldInput
                    id="ef-ss-year"
                    value={form.ss_year}
                    onChange={(e) => setField("ss_year", e.target.value)}
                    maxLength={4}
                  />
                </FieldCell>
              </Section>

              {/* Medical Registration */}
              <Section title="Medical Registration">
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-mci-no">MCI / Council number</FieldLabel>
                  <FieldInput
                    id="ef-mci-no"
                    value={form.mci_council_number}
                    onChange={(e) =>
                      setField("mci_council_number", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-mci-state">Council state</FieldLabel>
                  <FieldInput
                    id="ef-mci-state"
                    value={form.mci_council_state}
                    onChange={(e) =>
                      setField("mci_council_state", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-imr">IMR registration no</FieldLabel>
                  <FieldInput
                    id="ef-imr"
                    value={form.imr_registration_no}
                    onChange={(e) =>
                      setField("imr_registration_no", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-asi-no">ASI membership no</FieldLabel>
                  <FieldInput
                    id="ef-asi-no"
                    value={form.asi_membership_no}
                    onChange={(e) =>
                      setField("asi_membership_no", e.target.value)
                    }
                  />
                </FieldCell>
                <FieldCell span={3}>
                  <FieldLabel htmlFor="ef-asi-state">ASI state</FieldLabel>
                  <FieldInput
                    id="ef-asi-state"
                    value={form.asi_state}
                    onChange={(e) => setField("asi_state", e.target.value)}
                  />
                </FieldCell>
              </Section>
            </div>
          </form>

          {/* Footer — sticky-shaped: outside the scrollable body */}
          <div className="shrink-0 border-t px-4 py-4 sm:px-6">
            <div className="flex items-center justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={mutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="edit-application-fields-form"
                disabled={mutation.isPending}
                className="gap-1.5"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                Save changes
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---- Section + Field helpers (visual language from form-layout block) ----

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="px-4 py-6 sm:px-6 sm:py-8 space-y-5">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-6">
        {children}
      </div>
    </section>
  )
}

function FieldCell({
  span,
  children,
}: {
  span: 2 | 3 | 4 | "full"
  children: React.ReactNode
}) {
  const cls =
    span === "full"
      ? "col-span-1 sm:col-span-6"
      : span === 4
        ? "col-span-1 sm:col-span-4"
        : span === 3
          ? "col-span-1 sm:col-span-3"
          : "col-span-1 sm:col-span-2"
  return <div className={cls}>{children}</div>
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string
  children: React.ReactNode
}) {
  return (
    <Label
      htmlFor={htmlFor}
      className="block text-sm font-medium text-foreground"
    >
      {children}
    </Label>
  )
}

function FieldInput(
  props: React.InputHTMLAttributes<HTMLInputElement>,
) {
  return (
    <div className="mt-2">
      <input
        {...props}
        className={
          "block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-2 focus:-outline-offset-2 focus:outline-ring disabled:cursor-not-allowed disabled:opacity-50 " +
          (props.className ?? "")
        }
      />
    </div>
  )
}

function FieldSelect({
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="mt-2">
      <select
        {...props}
        className={
          "block w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-2 focus:-outline-offset-2 focus:outline-ring " +
          (props.className ?? "")
        }
      >
        {children}
      </select>
    </div>
  )
}

function LockedField({
  label,
  value,
  wide,
}: {
  label: string
  value: string
  wide?: boolean
}) {
  return (
    <FieldCell span={wide ? 3 : 2}>
      <Label className="block text-sm font-medium text-foreground flex items-center gap-1.5">
        <Lock className="h-3 w-3 text-muted-foreground" />
        {label}
      </Label>
      <div
        title="Locked — contact engineering to change"
        className="mt-2 block w-full rounded-md border border-input bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground truncate"
      >
        {value || "—"}
      </div>
    </FieldCell>
  )
}
