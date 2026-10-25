"use client"

import { use, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FIELD_LIMITS, SURVEY_NAMES, type SurveyField, type SurveyParticipantView } from "@/lib/survey"

type Loaded = { participant: SurveyParticipantView } | { error: string }

const FIELDS: { key: SurveyField; label: string; autoComplete: string }[] = [
  { key: "name", label: "Name (as it should appear in the manuscript)", autoComplete: "name" },
  { key: "hospital", label: "Place of work (hospital name)", autoComplete: "organization" },
  { key: "city", label: "City", autoComplete: "address-level2" },
]

/**
 * /survey/[token]: a survey participant sends the name, hospital and city to list them under in the manuscript.
 * No login: the link comes in their email and opens only their own row. Details we already hold are filled in.
 */
export default function SurveyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const { data, isLoading } = useQuery({
    queryKey: ["survey", token],
    queryFn: async (): Promise<Loaded> => {
      const res = await fetch(`/api/survey/${encodeURIComponent(token)}`, { cache: "no-store" })
      const body = await res.json().catch(() => ({}))
      return res.ok ? { participant: body.participant } : { error: body.error ?? "Could not load this page." }
    },
    retry: false,
  })

  if (isLoading) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-label="Loading" />
      </main>
    )
  }
  if (!data || "error" in data) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <Card>
          <CardContent className="pt-6 text-base">{data && "error" in data ? data.error : "Could not load this page."}</CardContent>
        </Card>
      </main>
    )
  }

  const p = data.participant
  const surveys = p.surveys.map((s) => SURVEY_NAMES[s] ?? s)
  return (
    <main className="mx-auto max-w-md space-y-4 px-4 py-6">
      <Card>
        <CardHeader className="pb-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">AMASI Survey Consortium</p>
          <CardTitle className="text-xl">Your details for the manuscript</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-base">
          <p>
            Thank you for taking part in the {surveys.join(" and the ")}. Please tell us how to list you as a participant in
            the manuscript.
          </p>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Email</p>
            <p className="font-medium break-all">{p.email}</p>
          </div>
        </CardContent>
      </Card>
      <DetailsForm token={token} participant={p} />
    </main>
  )
}

function DetailsForm({ token, participant: p }: { token: string; participant: SurveyParticipantView }) {
  const [values, setValues] = useState<Record<SurveyField, string>>({ name: p.name, hospital: p.hospital, city: p.city })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const prefilled = !p.submitted && !!(p.name || p.hospital || p.city)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/survey/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) setDone(true)
      else setMessage(body.error ?? "That did not save. Try again.")
    } catch {
      setMessage("No connection. Try again when you have signal.")
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <p className="flex items-start gap-2 text-base font-medium">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
        <span>Thank you. Your details have been received. You can open this link again to correct them.</span>
      </p>
    )
  }
  return (
    <form className="space-y-4" onSubmit={save}>
      {p.submitted && <p className="text-sm text-muted-foreground">We already have your details. Change anything below and send again.</p>}
      {prefilled && (
        <p className="text-sm text-muted-foreground">We have filled in what our records show. Please check it, add anything missing and send.</p>
      )}
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-1.5">
          <Label htmlFor={f.key}>{f.label}</Label>
          <Input
            id={f.key}
            required
            maxLength={FIELD_LIMITS[f.key]}
            autoComplete={f.autoComplete}
            value={values[f.key]}
            onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
          />
        </div>
      ))}
      {message && <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">{message}</p>}
      <Button type="submit" className="h-14 w-full text-lg" disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-5 w-5 animate-spin motion-reduce:animate-none" /> : null}
        Send my details
      </Button>
    </form>
  )
}
