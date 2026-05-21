"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Loader2, CheckCircle, AlertCircle, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

const OBJECTION_TYPES = [
  { value: "incorrect_details", label: "Details on the roll are incorrect" },
  { value: "should_be_removed", label: "This person should not be on the roll" },
  { value: "should_be_added", label: "A member is missing from the roll" },
  { value: "other", label: "Other (please describe)" },
] as const

type ObjectionType = (typeof OBJECTION_TYPES)[number]["value"]
type Phase = "form" | "submitting" | "success" | "error"

function ObjectionContent() {
  const searchParams = useSearchParams()
  const refFromQuery = searchParams.get("ref") || ""

  const [phase, setPhase] = useState<Phase>("form")
  const [errorMessage, setErrorMessage] = useState("")

  const [targetAmasiNumber, setTargetAmasiNumber] = useState(refFromQuery)
  const [objectionType, setObjectionType] = useState<ObjectionType | "">("")
  const [objectionText, setObjectionText] = useState("")
  const [objectorName, setObjectorName] = useState("")
  const [objectorEmail, setObjectorEmail] = useState("")
  const [objectorPhone, setObjectorPhone] = useState("")
  const [objectorRelation, setObjectorRelation] = useState("self")

  useEffect(() => {
    if (refFromQuery) setTargetAmasiNumber(refFromQuery)
  }, [refFromQuery])

  const requiresTarget = objectionType !== "" && objectionType !== "should_be_added"

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!objectionType) {
      toast.error("Please choose an objection type")
      return
    }
    if (!objectorName.trim()) {
      toast.error("Please enter your name")
      return
    }
    if (!objectorEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(objectorEmail.trim())) {
      toast.error("Please enter a valid email")
      return
    }
    if (objectionText.trim().length < 10) {
      toast.error("Please describe your objection in at least 10 characters")
      return
    }
    if (requiresTarget && !/^\d+$/.test(targetAmasiNumber.trim())) {
      toast.error("Please enter the AMASI number this objection refers to")
      return
    }

    setPhase("submitting")
    try {
      const res = await fetch("/api/electoral-roll/objections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_amasi_number: targetAmasiNumber.trim() ? parseInt(targetAmasiNumber.trim(), 10) : null,
          objection_type: objectionType,
          objection_text: objectionText.trim(),
          objector_name: objectorName.trim(),
          objector_email: objectorEmail.trim(),
          objector_phone: objectorPhone.trim() || null,
          objector_relation: objectorRelation,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.status) {
        setErrorMessage(json.message || "Failed to submit objection. Please try again.")
        setPhase("error")
        return
      }
      setPhase("success")
    } catch {
      setErrorMessage("Network error. Please check your connection and try again.")
      setPhase("error")
    }
  }

  if (phase === "success") {
    return (
      <Card>
        <CardContent className="pt-8 pb-8 text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle className="h-7 w-7 text-green-600" />
          </div>
          <h2 className="text-lg font-semibold">Objection recorded</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Thank you. The Election Officer will review your objection and may contact you at{" "}
            <span className="font-medium text-foreground">{objectorEmail}</span> if more information is needed.
          </p>
          <div className="pt-2 flex items-center justify-center gap-3">
            <Link href="/electoral-roll">
              <Button variant="outline" size="sm">Back to the roll</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (phase === "error") {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-8 pb-8 text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
            <AlertCircle className="h-7 w-7 text-destructive" />
          </div>
          <p className="font-medium text-foreground">{errorMessage}</p>
          <Button variant="outline" size="sm" onClick={() => setPhase("form")}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">What is the objection?</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <Label className="text-xs">
              Objection type <span className="text-destructive">*</span>
            </Label>
            <select
              required
              value={objectionType}
              onChange={(e) => setObjectionType(e.target.value as ObjectionType)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {OBJECTION_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {objectionType !== "should_be_added" && (
            <div className="space-y-2">
              <Label className="text-xs">
                AMASI number being objected to {requiresTarget && <span className="text-destructive">*</span>}
              </Label>
              <Input
                inputMode="numeric"
                pattern="\d*"
                placeholder="e.g. 18260"
                value={targetAmasiNumber}
                onChange={(e) => setTargetAmasiNumber(e.target.value.replace(/\D/g, ""))}
              />
              <p className="text-xs text-muted-foreground">
                Find the AMASI number in the roll&apos;s left-most column.
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-xs">
              Describe the objection <span className="text-destructive">*</span>
            </Label>
            <Textarea
              required
              rows={5}
              minLength={10}
              maxLength={4000}
              placeholder="Provide as much detail as possible. The Election Officer may follow up with you."
              value={objectionText}
              onChange={(e) => setObjectionText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {objectionText.length}/4000 characters
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Your contact details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">
                Your name <span className="text-destructive">*</span>
              </Label>
              <Input
                required
                value={objectorName}
                onChange={(e) => setObjectorName(e.target.value)}
                placeholder="Full name"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">
                Your email <span className="text-destructive">*</span>
              </Label>
              <Input
                type="email"
                required
                value={objectorEmail}
                onChange={(e) => setObjectorEmail(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-xs">Your phone (optional)</Label>
              <Input
                type="tel"
                value={objectorPhone}
                onChange={(e) => setObjectorPhone(e.target.value)}
                placeholder="98XXXXXXXX"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Relationship to this entry</Label>
              <select
                value={objectorRelation}
                onChange={(e) => setObjectorRelation(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="self">This is about my own record</option>
                <option value="colleague">Colleague</option>
                <option value="amasi_office">AMASI Office Bearer</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <Link href="/electoral-roll">
          <Button type="button" variant="ghost" size="sm">
            <ChevronLeft className="h-4 w-4 mr-1" />
            Back to the roll
          </Button>
        </Link>
        <Button type="submit" size="lg" disabled={phase === "submitting"}>
          {phase === "submitting" ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Submitting…
            </>
          ) : (
            "Submit objection"
          )}
        </Button>
      </div>
    </form>
  )
}

export default function ObjectionPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Electoral Roll 2026</p>
          <h1 className="text-3xl font-bold tracking-tight">File an objection</h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            Use this form to flag an incorrect entry, request removal of an entry, or report a member missing
            from the roll. The Election Officer reviews every objection.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="py-12 text-center">
              <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
            </div>
          }
        >
          <ObjectionContent />
        </Suspense>
      </div>
    </div>
  )
}
