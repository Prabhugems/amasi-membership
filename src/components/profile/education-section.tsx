"use client"

import { useState } from "react"
import { CheckCircle2, GraduationCap, Lock, Search, BookOpen, Award, Plus } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Autocomplete } from "@/components/ui/autocomplete"
import { MEDICAL_COLLEGES_INDIA } from "@/data/medical-colleges-india"
import type { ProfileFormData } from "@/lib/profile-mapper"

const COLLEGE_OPTIONS = MEDICAL_COLLEGES_INDIA.map(c => ({
  label: c.name,
  sublabel: `${c.state} — ${c.university}`,
  state: c.state,
  university: c.university,
}))

// AMASI eligible degrees — minimal access / surgical specialties only
const PG_DEGREES = [
  "MS General Surgery", "MS Obstetrics & Gynaecology",
  "MCh Surgical Oncology", "MCh Urology", "MCh Cardiothoracic Surgery",
  "MCh Neurosurgery", "MCh Plastic Surgery", "MCh Paediatric Surgery",
  "MCh GI Surgery", "MCh Surgical Gastroenterology",
  "DNB General Surgery", "DNB Obstetrics & Gynaecology",
  "DNB Surgical Oncology", "DNB Urology",
  "FRCS", "MRCS",
  "Other",
]

// Quick-select pill buttons for most common AMASI degrees
const PG_PILL_DEGREES = [
  "MS General Surgery", "MS Obstetrics & Gynaecology",
  "MCh", "DNB General Surgery", "FRCS",
]

const YEAR_OPTIONS = Array.from({ length: 50 }, (_, i) => String(2026 - i))

// --- Inline helper components for this section ---

function EduField({ label, value, onChange, placeholder, show = true }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; show?: boolean
}) {
  if (!show) return null
  return (
    <div>
      <Label className="text-sm font-medium">{label}</Label>
      <Input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-1.5" />
    </div>
  )
}

function EduSelect({ label, value, onChange, options, required, searchable, allowCustom, show = true }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; required?: boolean; searchable?: boolean; allowCustom?: boolean; show?: boolean
}) {
  if (!show) return null
  const isEmpty = required && !value
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const filtered = searchable && search ? options.filter((o) => o.toLowerCase().includes(search.toLowerCase())) : options
  const isCustomValue = value && !options.includes(value)

  return (
    <div className={`relative ${open ? "z-[60]" : ""}`}>
      <Label className="text-sm font-medium">
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {searchable ? (
        <div className="relative">
          <Input
            value={open ? search : value}
            onChange={(e) => { setSearch(e.target.value); if (!open) setOpen(true) }}
            onFocus={() => { setOpen(true); setSearch("") }}
            onBlur={() => setTimeout(() => setOpen(false), 200)}
            placeholder={`Search ${label.toLowerCase()}...`}
            className={`mt-1.5 ${isEmpty ? "border-amber-400 bg-amber-50/50 focus-visible:ring-amber-400" : ""}`}
          />
          {value && !open && <CheckCircle2 className="absolute right-3 top-[calc(50%+3px)] h-3.5 w-3.5 text-green-500" />}
          {open && (
            <div className="absolute z-50 mt-1 w-full max-h-52 overflow-auto rounded-lg border bg-popover shadow-lg ring-1 ring-black/5">
              {filtered.length === 0 && <p className="px-3 py-2.5 text-sm text-muted-foreground">No results found</p>}
              {filtered.map((opt) => (
                <button key={opt} type="button"
                  className={`w-full px-3 py-2.5 text-left text-sm transition-colors flex items-center gap-2 ${opt === value ? "bg-primary/10 text-primary font-medium" : "hover:bg-accent"}`}
                  onMouseDown={(e) => { e.preventDefault(); onChange(opt); setSearch(""); setOpen(false) }}
                >
                  {opt === value && <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />}
                  <span>{opt}</span>
                </button>
              ))}
              {allowCustom && search && !filtered.includes(search) && (
                <button type="button" className="w-full px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors text-primary border-t font-medium"
                  onMouseDown={(e) => { e.preventDefault(); onChange(search); setSearch(""); setOpen(false) }}>
                  Use &ldquo;{search}&rdquo;
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <select value={value} onChange={(e) => onChange(e.target.value)}
          className={`flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring mt-1.5 ${isEmpty ? "border-amber-400 bg-amber-50/50" : "border-input"}`}>
          <option value="">Select...</option>
          {isCustomValue && <option value={value}>{value}</option>}
          {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      )}
    </div>
  )
}

// --- Main Education Section ---

export function EducationSection({ data, update, onChange, quickFill }: {
  data: ProfileFormData
  update: (field: keyof ProfileFormData, value: string) => void
  onChange: (updated: ProfileFormData) => void
  quickFill: boolean
}) {
  const [showSuperSpecialty, setShowSuperSpecialty] = useState(
    !!(data.eduSuperspecialtyDegree || data.eduSuperspecialtyCollege)
  )
  const [showPgOther, setShowPgOther] = useState(
    !!(data.eduPostgradDegree && !PG_PILL_DEGREES.includes(data.eduPostgradDegree))
  )

  const ugCollegeMatch = COLLEGE_OPTIONS.find(c => c.label === data.eduUndergradCollege)
  const pgCollegeMatch = COLLEGE_OPTIONS.find(c => c.label === data.eduPostgradCollege)

  const summaryParts: string[] = []
  if (data.eduPostgradDegree) {
    let s = data.eduPostgradDegree
    if (data.eduPostgradCollege) s += ` \u2014 ${data.eduPostgradCollege}`
    if (data.eduPostgradYear) s += ` (${data.eduPostgradYear})`
    summaryParts.push(s)
  }
  if (data.eduUndergradCollege) {
    let s = data.eduUndergradDegree || "MBBS"
    s += ` \u2014 ${data.eduUndergradCollege}`
    if (data.eduUndergradYear) s += ` (${data.eduUndergradYear})`
    summaryParts.push(s)
  }

  return (
    <div className="space-y-6">
      {/* UG Card */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-br from-blue-50/40 to-transparent p-5 overflow-visible relative">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-blue-100 text-blue-600">
            <BookOpen className="h-3.5 w-3.5" />
          </div>
          <h4 className="text-sm font-semibold text-foreground">Undergraduate (MBBS)</h4>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <EduField label="Degree" value={data.eduUndergradDegree} onChange={(v) => update("eduUndergradDegree", v)} placeholder="MBBS" show={!quickFill} />

          {/* College Autocomplete with enhanced UX */}
          <div className={`sm:col-span-2 ${quickFill ? "hidden" : ""}`}>
            <Label className="text-sm font-medium">College</Label>
            <div className="relative mt-1.5">
              <Autocomplete
                value={data.eduUndergradCollege}
                onChange={(v) => {
                  const match = COLLEGE_OPTIONS.find(c => c.label === v)
                  if (match) onChange({ ...data, eduUndergradCollege: v, eduUndergradUniversity: match.university })
                  else update("eduUndergradCollege", v)
                }}
                options={COLLEGE_OPTIONS}
                placeholder="Type 2+ characters to search 757 medical colleges"
              />
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
            </div>
            {ugCollegeMatch && (
              <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200/60">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">{data.eduUndergradCollege}</p>
                  <p className="text-xs text-green-600">{ugCollegeMatch.state} &middot; {ugCollegeMatch.university}</p>
                </div>
              </div>
            )}
            {!ugCollegeMatch && !data.eduUndergradCollege && (
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                <Search className="h-3 w-3" /> Search from NMC-recognized colleges across India
              </p>
            )}
          </div>

          {/* University (auto-filled from college) */}
          <div className={quickFill ? "hidden" : ""}>
            <Label className="text-sm font-medium">University</Label>
            <Input
              value={data.eduUndergradUniversity}
              onChange={(e) => update("eduUndergradUniversity", e.target.value)}
              placeholder="Auto-fills from college selection"
              readOnly={!!ugCollegeMatch}
              className={`mt-1.5 ${ugCollegeMatch ? "bg-muted/60 text-muted-foreground cursor-not-allowed border-dashed" : ""}`}
            />
            {ugCollegeMatch && (
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" /> Auto-filled from college selection
              </p>
            )}
          </div>

          <EduSelect label="Year of Passing" value={data.eduUndergradYear} onChange={(v) => update("eduUndergradYear", v)} options={YEAR_OPTIONS} show={!quickFill} />
        </div>
      </div>

      {/* PG Card */}
      <div className="rounded-xl border border-border/60 bg-gradient-to-br from-purple-50/40 to-transparent p-5 overflow-visible relative">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-purple-100 text-purple-600">
            <GraduationCap className="h-3.5 w-3.5" />
          </div>
          <h4 className="text-sm font-semibold text-foreground">
            Postgraduate Degree <span className="text-destructive">*</span>
          </h4>
        </div>

        {/* PG Degree - Pill buttons for top 8 + Other */}
        <div className={`mb-5 ${quickFill && data.eduPostgradDegree ? "hidden" : ""}`}>
          <Label className="text-sm font-medium mb-2 block">
            PG Degree <span className="text-destructive">*</span>
          </Label>
          <div className="flex flex-wrap gap-2">
            {PG_PILL_DEGREES.map((deg) => {
              const isSelected = data.eduPostgradDegree === deg
              return (
                <button
                  key={deg}
                  type="button"
                  onClick={() => { update("eduPostgradDegree", deg); setShowPgOther(false) }}
                  className={`px-3.5 py-2 rounded-full text-sm font-medium border transition-all duration-150 ${
                    isSelected
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-background border-border hover:border-primary/50 hover:bg-primary/5 text-foreground"
                  }`}
                >
                  {isSelected && <CheckCircle2 className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />}
                  {deg}
                </button>
              )
            })}
            <button
              type="button"
              onClick={() => { setShowPgOther(true); if (PG_PILL_DEGREES.includes(data.eduPostgradDegree)) update("eduPostgradDegree", "") }}
              className={`px-3.5 py-2 rounded-full text-sm font-medium border transition-all duration-150 ${
                showPgOther
                  ? "bg-primary text-primary-foreground border-primary shadow-sm"
                  : "bg-background border-border hover:border-primary/50 hover:bg-primary/5 text-foreground"
              }`}
            >
              {showPgOther && <CheckCircle2 className="h-3.5 w-3.5 inline mr-1.5 -mt-0.5" />}
              Other
            </button>
          </div>
          {showPgOther && (
            <div className="mt-3 relative z-[60]">
              <EduSelect
                label="Select or type your PG Degree"
                value={data.eduPostgradDegree}
                onChange={(v) => update("eduPostgradDegree", v)}
                options={PG_DEGREES.filter(d => !PG_PILL_DEGREES.includes(d) && d !== "Other")}
                searchable
                allowCustom
              />
            </div>
          )}
          {!data.eduPostgradDegree && (
            <p className="text-xs text-amber-600 mt-2">Please select your postgraduate degree</p>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* PG College Autocomplete */}
          <div className={`sm:col-span-2 ${quickFill && data.eduPostgradCollege ? "hidden" : ""}`}>
            <Label className="text-sm font-medium">PG College</Label>
            <div className="relative mt-1.5">
              <Autocomplete
                value={data.eduPostgradCollege}
                onChange={(v) => {
                  const match = COLLEGE_OPTIONS.find(c => c.label === v)
                  if (match) onChange({ ...data, eduPostgradCollege: v, eduPostgradUniversity: match.university })
                  else update("eduPostgradCollege", v)
                }}
                options={COLLEGE_OPTIONS}
                placeholder="Type 2+ characters to search 757 medical colleges"
              />
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground/50 pointer-events-none" />
            </div>
            {pgCollegeMatch && (
              <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-green-50 border border-green-200/60">
                <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-green-800">{data.eduPostgradCollege}</p>
                  <p className="text-xs text-green-600">{pgCollegeMatch.state} &middot; {pgCollegeMatch.university}</p>
                </div>
              </div>
            )}
            {!pgCollegeMatch && !data.eduPostgradCollege && (
              <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                <Search className="h-3 w-3" /> Search from NMC-recognized colleges across India
              </p>
            )}
          </div>

          {/* PG University (auto-filled) */}
          <div className={quickFill && data.eduPostgradUniversity ? "hidden" : ""}>
            <Label className="text-sm font-medium">PG University</Label>
            <Input
              value={data.eduPostgradUniversity}
              onChange={(e) => update("eduPostgradUniversity", e.target.value)}
              placeholder="Auto-fills from college selection"
              readOnly={!!pgCollegeMatch}
              className={`mt-1.5 ${pgCollegeMatch ? "bg-muted/60 text-muted-foreground cursor-not-allowed border-dashed" : ""}`}
            />
            {pgCollegeMatch && (
              <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                <Lock className="h-2.5 w-2.5" /> Auto-filled from college selection
              </p>
            )}
          </div>

          <EduSelect label="PG Year of Passing" value={data.eduPostgradYear} onChange={(v) => update("eduPostgradYear", v)}
            options={YEAR_OPTIONS} show={!quickFill || !data.eduPostgradYear} />
        </div>
      </div>

      {/* Super Specialty - optional expandable */}
      {!showSuperSpecialty ? (
        <button
          type="button"
          onClick={() => setShowSuperSpecialty(true)}
          className="w-full flex items-center justify-center gap-2 py-3.5 px-4 rounded-xl border-2 border-dashed border-border/60 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/40 hover:bg-primary/5 transition-all duration-150"
        >
          <Plus className="h-4 w-4" />
          Add Super Specialty (optional)
        </button>
      ) : (
        <div className="rounded-xl border border-border/60 bg-gradient-to-br from-amber-50/40 to-transparent p-5 overflow-visible relative">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center justify-center h-7 w-7 rounded-lg bg-amber-100 text-amber-600">
                <Award className="h-3.5 w-3.5" />
              </div>
              <h4 className="text-sm font-semibold text-foreground">Super Specialty</h4>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground border-border">
                Optional
              </Badge>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground hover:text-destructive h-7 px-2"
              onClick={() => {
                setShowSuperSpecialty(false)
                update("eduSuperspecialtyDegree", "")
                update("eduSuperspecialtyCollege", "")
                update("eduSuperspecialtyUniversity", "")
                update("eduSuperspecialtyYear", "")
              }}
            >
              Remove
            </Button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <EduField label="Degree" value={data.eduSuperspecialtyDegree} onChange={(v) => update("eduSuperspecialtyDegree", v)} placeholder="e.g. MCh Surgical Oncology" />
            <EduField label="College" value={data.eduSuperspecialtyCollege} onChange={(v) => update("eduSuperspecialtyCollege", v)} placeholder="e.g. Cancer Institute, Adyar" />
            <EduField label="University" value={data.eduSuperspecialtyUniversity} onChange={(v) => update("eduSuperspecialtyUniversity", v)} placeholder="e.g. The Tamil Nadu Dr. MGR Medical University" />
            <EduSelect label="Year of Passing" value={data.eduSuperspecialtyYear} onChange={(v) => update("eduSuperspecialtyYear", v)} options={YEAR_OPTIONS} />
          </div>
        </div>
      )}

      {/* Education Summary */}
      {summaryParts.length > 0 && (
        <div className="rounded-lg bg-muted/30 border border-border/40 px-4 py-3">
          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Education Summary</p>
          {summaryParts.map((part, i) => (
            <p key={i} className="text-sm text-foreground leading-relaxed">{part}</p>
          ))}
          {data.eduSuperspecialtyDegree && (
            <p className="text-sm text-foreground leading-relaxed">
              {data.eduSuperspecialtyDegree}
              {data.eduSuperspecialtyCollege ? ` \u2014 ${data.eduSuperspecialtyCollege}` : ""}
              {data.eduSuperspecialtyYear ? ` (${data.eduSuperspecialtyYear})` : ""}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
