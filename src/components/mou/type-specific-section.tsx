"use client"

import { Loader2, Upload, X, Plus, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { TypeSpecificFieldDef } from "@/lib/mou/event-type-config"

export function defaultTypeSpecificValues(fields: TypeSpecificFieldDef[]): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    switch (field.kind) {
      case "text":
      case "textarea":
      case "number":
      case "radio":
        values[field.key] = ""
        break
      case "checkbox":
        values[field.key] = false
        break
      case "faculty-rows":
        values.faculty = []
        break
      case "association-rows":
        values.partner_associations = []
        break
      case "conditional-upload":
        values[`${field.docType}_url`] = ""
        break
      case "facilities-group": {
        const group: Record<string, unknown> = {}
        for (const item of field.items) group[item.key] = item.kind === "checkbox" ? false : ""
        values.facilities = group
        break
      }
    }
  }
  return values
}

interface TypeSpecificSectionProps {
  fields: TypeSpecificFieldDef[]
  values: Record<string, unknown>
  onChange: (key: string, value: unknown) => void
  onUpload: (docType: string, file: File) => void
  uploadingKeys: Set<string>
  emailVerified: boolean
}

// One generic renderer over TypeSpecificFieldDef[] — rural_program and
// workshop supply different arrays (Task 3); this component doesn't know
// or care which type it's rendering.
export function TypeSpecificSection({ fields, values, onChange, onUpload, uploadingKeys, emailVerified }: TypeSpecificSectionProps) {
  return (
    <div className="space-y-4">
      {fields.map((field) => {
        switch (field.kind) {
          case "text":
          case "number":
            return (
              <div key={field.key}>
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <Input
                  type={field.kind}
                  value={String(values[field.key] ?? "")}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  className="mt-1"
                />
                {field.helperText && <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>}
              </div>
            )
          case "textarea":
            return (
              <div key={field.key}>
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <textarea
                  value={String(values[field.key] ?? "")}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  maxLength={field.maxLength}
                  rows={3}
                  className="mt-1 flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
                {field.helperText && <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>}
              </div>
            )
          case "checkbox":
            return (
              <label key={field.key} className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={Boolean(values[field.key])}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-input"
                />
                <span>
                  {field.label}
                  {field.helperText && <span className="block text-xs text-muted-foreground mt-0.5">{field.helperText}</span>}
                </span>
              </label>
            )
          case "radio":
            return (
              <div key={field.key}>
                <Label className="text-xs">
                  {field.label}
                  {field.required && <span className="text-destructive ml-0.5">*</span>}
                </Label>
                <div className="mt-1 space-y-1.5">
                  {field.options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={field.key}
                        checked={values[field.key] === opt.value}
                        onChange={() => onChange(field.key, opt.value)}
                        className="h-4 w-4"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                {field.helperText && <p className="mt-1 text-xs text-muted-foreground">{field.helperText}</p>}
              </div>
            )
          case "conditional-upload": {
            const url = String(values[`${field.docType}_url`] ?? "")
            const uploading = uploadingKeys.has(field.docType)
            return (
              <div key={field.key}>
                <Label className="text-xs">{field.label}</Label>
                {url ? (
                  <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
                    <span>Uploaded</span>
                    <button type="button" onClick={() => onChange(`${field.docType}_url`, "")} className="text-muted-foreground hover:text-foreground">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <label className={cn("mt-1 flex items-center justify-center gap-2 rounded-md border border-dashed border-input px-3 py-2.5 text-sm text-muted-foreground", emailVerified ? "cursor-pointer hover:border-primary/50" : "opacity-50")}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {uploading ? "Uploading…" : "Click to upload (JPG, PNG, or PDF, max 5MB)"}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      disabled={!emailVerified || uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) onUpload(field.docType, file)
                        e.target.value = ""
                      }}
                    />
                  </label>
                )}
              </div>
            )
          }
          case "facilities-group": {
            const group = (values.facilities ?? {}) as Record<string, unknown>
            return (
              <div key={field.key}>
                <Label className="text-xs">Facilities</Label>
                <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {field.items.map((item) =>
                    item.kind === "checkbox" ? (
                      <label key={item.key} className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(group[item.key])}
                          onChange={(e) => onChange("facilities", { ...group, [item.key]: e.target.checked })}
                          className="h-4 w-4 rounded border-input"
                        />
                        {item.label}
                      </label>
                    ) : (
                      <div key={item.key}>
                        <Label className="text-xs">{item.label}</Label>
                        <Input
                          type="number"
                          value={String(group[item.key] ?? "")}
                          onChange={(e) => onChange("facilities", { ...group, [item.key]: e.target.value })}
                          className="mt-1"
                        />
                      </div>
                    )
                  )}
                </div>
              </div>
            )
          }
          case "faculty-rows": {
            const rows = (values.faculty ?? []) as Array<{ name: string; amasi_membership_number: string | null; speciality: string | null; is_amasi_member: boolean }>
            const setRows = (next: typeof rows) => onChange("faculty", next)
            return (
              <div key={field.key}>
                <Label className="text-xs">Faculty ({field.minRows}-{field.maxRows} rows)</Label>
                <div className="mt-2 space-y-3">
                  {rows.map((row, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-4 items-end border border-border rounded-md p-3">
                      <div>
                        <Label className="text-xs">Name</Label>
                        <Input value={row.name} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">AMASI #</Label>
                        <Input value={row.amasi_membership_number ?? ""} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, amasi_membership_number: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">Speciality{!row.is_amasi_member && <span className="text-destructive ml-0.5">*</span>}</Label>
                        <Input value={row.speciality ?? ""} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, speciality: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-xs">
                          <input type="checkbox" checked={row.is_amasi_member} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, is_amasi_member: e.target.checked } : r)))} />
                          AMASI member
                        </label>
                        <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {rows.length < field.maxRows && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", amasi_membership_number: null, speciality: null, is_amasi_member: true }])}>
                      <Plus className="h-3.5 w-3.5" /> Add faculty
                    </Button>
                  )}
                </div>
              </div>
            )
          }
          case "association-rows": {
            const rows = (values.partner_associations ?? []) as Array<{ name: string; consent_letter_url: string | null }>
            const setRows = (next: typeof rows) => onChange("partner_associations", next)
            const uploading = (i: number) => uploadingKeys.has(`consent_partner_association:${i}`)
            return (
              <div key={field.key}>
                <Label className="text-xs">Partner associations (max {field.maxRows})</Label>
                <div className="mt-2 space-y-3">
                  {rows.map((row, i) => (
                    <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-2 items-end border border-border rounded-md p-3">
                      <div>
                        <Label className="text-xs">Association name</Label>
                        <Input value={row.name} onChange={(e) => setRows(rows.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))} className="mt-1" />
                      </div>
                      <div className="flex items-center gap-2">
                        {row.consent_letter_url ? (
                          <span className="text-sm text-muted-foreground">Consent letter uploaded</span>
                        ) : (
                          <label className={cn("flex items-center gap-2 text-sm border border-dashed rounded-md px-3 py-2", emailVerified ? "cursor-pointer" : "opacity-50")}>
                            {uploading(i) ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            Consent letter
                            <input
                              type="file"
                              accept="image/jpeg,image/png,application/pdf"
                              className="hidden"
                              disabled={!emailVerified || uploading(i)}
                              onChange={(e) => {
                                const file = e.target.files?.[0]
                                if (file) onUpload(`consent_partner_association:${i}`, file)
                                e.target.value = ""
                              }}
                            />
                          </label>
                        )}
                        <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                  {rows.length < field.maxRows && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", consent_letter_url: null }])}>
                      <Plus className="h-3.5 w-3.5" /> Add association
                    </Button>
                  )}
                </div>
              </div>
            )
          }
        }
      })}
    </div>
  )
}
