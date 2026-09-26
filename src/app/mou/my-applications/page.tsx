"use client"

import { useState } from "react"
import Link from "next/link"
import { toast } from "sonner"
import { ArrowLeft, Loader2 } from "lucide-react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { StatusBadge } from "@/components/mou/status-badge"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import type { ApplicationStatus, ApplicationTypeId } from "@/lib/mou/types"

interface ApplicationRow {
  id: string
  application_type_id: ApplicationTypeId
  status: ApplicationStatus
  event_name: string | null
  created_at: string
}

function formatDate(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

export default function MyMouApplicationsPage() {
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [step, setStep] = useState<"email" | "code" | "list">("email")
  const [sending, setSending] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [applications, setApplications] = useState<ApplicationRow[]>([])

  async function sendOtp() {
    if (!email) return
    setSending(true)
    try {
      const res = await fetch("/api/mou/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!data.status) {
        toast.error(data.message || "Could not send code")
        return
      }
      setStep("code")
      toast.success("Code sent — check your email")
    } catch {
      toast.error("Could not send code")
    } finally {
      setSending(false)
    }
  }

  async function verifyAndList() {
    if (!code) return
    setVerifying(true)
    try {
      const verifyRes = await fetch("/api/mou/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      })
      const verifyData = await verifyRes.json()
      if (!verifyData.status) {
        toast.error(verifyData.message || "Invalid code")
        return
      }
      setLoadingList(true)
      const listRes = await fetch("/api/mou/my-applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const listData = await listRes.json()
      if (!listData.status) {
        toast.error(listData.message || "Could not load your applications")
        return
      }
      setApplications(listData.applications ?? [])
      setStep("list")
    } catch {
      toast.error("Could not verify code")
    } finally {
      setVerifying(false)
      setLoadingList(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:px-8">
        <Link href="/mou" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to applications
        </Link>

        <div className="mt-4 mb-8">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">My applications</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground">Find your applications</h1>
        </div>

        {step !== "list" && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-semibold">Verify your email</CardTitle>
              <CardDescription>
                Enter the email you applied with — we&apos;ll list every application tied to it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1" disabled={step === "code"} />
              </div>
              {step === "email" ? (
                <Button onClick={sendOtp} disabled={sending || !email} size="sm">
                  {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Send code
                </Button>
              ) : (
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">Code</Label>
                    <Input value={code} onChange={(e) => setCode(e.target.value)} className="mt-1" />
                  </div>
                  <Button onClick={verifyAndList} disabled={verifying || loadingList || !code} size="sm">
                    {(verifying || loadingList) && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Verify and view applications
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {step === "list" && (
          <div className="space-y-3">
            {applications.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No applications found for this email.
                </CardContent>
              </Card>
            ) : (
              applications.map((app) => (
                <Link key={app.id} href={`/mou/status/${app.id}`}>
                  <Card className="transition-colors hover:border-primary/40">
                    <CardContent className="flex items-center justify-between gap-3 py-4">
                      <div>
                        <p className="text-sm font-medium text-foreground">
                          {app.event_name || getEventTypeConfig(app.application_type_id)?.label || app.application_type_id}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Submitted {formatDate(app.created_at)}</p>
                      </div>
                      <StatusBadge status={app.status} />
                    </CardContent>
                  </Card>
                </Link>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
