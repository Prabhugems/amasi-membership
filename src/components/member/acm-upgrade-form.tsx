"use client"

import { useState } from "react"
import { CheckCircle, Clock, FileText, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { INDIAN_STATES } from "@/lib/membership-types"

interface Props {
  memberId: string
  amasiNumber: string | number
  hasPending: boolean
  onSubmitted?: () => void
}

type Result = { success: boolean; message: string; autoApproved?: boolean }

const MAX_BYTES = 5 * 1024 * 1024

/**
 * ACM -> ALM / LM self-service upgrade. The server decides the target type:
 * a verified PG degree gives ALM; a verified PG degree plus a verified ASI
 * membership gives LM. Anything it cannot verify goes to the AMASI office.
 */
export function AcmUpgradeForm({ memberId, amasiNumber, hasPending, onSubmitted }: Props) {
  const [pgFile, setPgFile] = useState<File | null>(null)
  const [hasAsi, setHasAsi] = useState(false)
  const [asiNumber, setAsiNumber] = useState("")
  const [asiState, setAsiState] = useState("")
  const [asiFile, setAsiFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  const pick = (setter: (f: File | null) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null
    if (f && f.size > MAX_BYTES) {
      toast.error("File must be 5 MB or smaller")
      e.target.value = ""
      return
    }
    setter(f)
  }

  const canSubmit = !!pgFile && (!hasAsi || (!!asiNumber.trim() && !!asiFile)) && !submitting

  const submit = async () => {
    if (!pgFile) return
    setSubmitting(true)
    setResult(null)
    try {
      const fd = new FormData()
      fd.append(
        "data",
        JSON.stringify({
          memberId,
          asiMembershipNo: hasAsi ? asiNumber.trim() : "",
          asiState: hasAsi ? asiState || null : null,
        })
      )
      fd.append("pg_degree", pgFile)
      if (hasAsi && asiFile) fd.append("asi_certificate", asiFile)

      const res = await fetch("/api/members/upgrade/acm", { method: "POST", body: fd })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.status) {
        const message = json?.message || "Could not submit your upgrade. Please try again."
        setResult({ success: false, message })
        toast.error(message)
        return
      }
      setResult({ success: true, message: json.message, autoApproved: json.auto_approved })
      toast.success(json.auto_approved ? "Membership upgraded" : "Submitted for review")
      onSubmitted?.()
    } catch (err) {
      console.error("ACM upgrade submit failed", err)
      setResult({ success: false, message: "Network error. Please try again." })
      toast.error("Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (result?.success) {
    return (
      <Card>
        <CardContent className="py-10 px-6 text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-md bg-muted border flex items-center justify-center">
            {result.autoApproved ? (
              <CheckCircle className="h-6 w-6 text-green-600" />
            ) : (
              <Clock className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
          <p className="text-sm font-medium">{result.message}</p>
          {result.autoApproved && (
            <p className="text-xs text-muted-foreground">Reload this page to see your updated membership.</p>
          )}
        </CardContent>
      </Card>
    )
  }

  if (hasPending) {
    return (
      <Card>
        <CardContent className="py-10 px-6 text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-md bg-muted border flex items-center justify-center">
            <Clock className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">Your upgrade request is being reviewed by the AMASI office.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardContent className="p-6 space-y-5">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">AMASI #{amasiNumber}</p>
          <h3 className="text-lg font-bold">Upgrade after completing your PG</h3>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Upload your completed PG degree certificate. Once it is verified you become an Associate Life Member. If you also hold an ASI membership,
            add it below and you become a Life Member.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="acm-pg-degree">PG degree certificate (MS / MCh / DNB)</label>
          <Input id="acm-pg-degree" type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={pick(setPgFile)} />
          {pgFile && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <FileText className="h-3.5 w-3.5" /> {pgFile.name}
            </p>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={hasAsi} onChange={(e) => setHasAsi(e.target.checked)} />
          I have an ASI membership number
        </label>

        {hasAsi && (
          <div className="space-y-4 rounded-md border p-4">
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="acm-asi-no">ASI membership number</label>
              <Input id="acm-asi-no" value={asiNumber} onChange={(e) => setAsiNumber(e.target.value)} maxLength={20} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="acm-asi-state">State chapter (optional)</label>
              <select
                id="acm-asi-state"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={asiState}
                onChange={(e) => setAsiState(e.target.value)}
              >
                <option value="">Select state</option>
                {INDIAN_STATES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="acm-asi-cert">ASI membership certificate</label>
              <Input id="acm-asi-cert" type="file" accept=".jpg,.jpeg,.png,.pdf" onChange={pick(setAsiFile)} />
            </div>
          </div>
        )}

        {result && !result.success && (
          <p className="text-sm text-destructive" role="alert">{result.message}</p>
        )}

        <Button onClick={submit} disabled={!canSubmit}>
          {submitting && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Submit for verification
        </Button>
        <p className="text-xs text-muted-foreground">
          Documents are read automatically. If anything cannot be verified, the AMASI office reviews it and you will be emailed.
        </p>
      </CardContent>
    </Card>
  )
}
