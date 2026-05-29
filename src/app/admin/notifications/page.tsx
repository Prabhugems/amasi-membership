"use client"

// Admin → Notifications → Send Push.
//
// Composes a single notification and dispatches it to a chosen audience.
// Always writes to the in-app inbox (`member_notifications`); also fires
// FCM when FCM_SERVICE_ACCOUNT_KEY is configured server-side.
//
// Backed by POST /api/admin/notifications/send-push.

import { useState } from "react"
import { Bell, Send, Loader2, Users, Tag, MapPin, Hash } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

const ZONES = [
  "North Zone",
  "South Zone",
  "East Zone",
  "West Zone",
  "Central Zone",
  "International",
]
const MEMBERSHIP_TYPES = ["LM", "ALM", "ACM", "ILM"]

type AudienceKind = "all" | "membership_type" | "zone" | "amasi_numbers"

interface SendResult {
  status: boolean
  message?: string
  broadcast_id?: string
  audience_count?: number
  inbox_inserted?: number
  push?: { attempted: number; sent: number; failed: number; skipped: boolean }
}

export default function AdminNotificationsPage() {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [imageUrl, setImageUrl] = useState("")
  const [actionUrl, setActionUrl] = useState("")
  const [audienceKind, setAudienceKind] = useState<AudienceKind>("all")
  const [membershipType, setMembershipType] = useState(MEMBERSHIP_TYPES[0])
  const [zone, setZone] = useState(ZONES[0])
  const [amasiNumbersInput, setAmasiNumbersInput] = useState("")
  const [inAppOnly, setInAppOnly] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [lastResult, setLastResult] = useState<SendResult | null>(null)

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !body.trim()) {
      toast.error("Title and body are required")
      return
    }

    let audience: { kind: AudienceKind; value?: unknown }
    if (audienceKind === "all") {
      audience = { kind: "all" }
    } else if (audienceKind === "membership_type") {
      audience = { kind: "membership_type", value: membershipType }
    } else if (audienceKind === "zone") {
      audience = { kind: "zone", value: zone }
    } else {
      const nums = amasiNumbersInput
        .split(/[\s,]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n))
      if (nums.length === 0) {
        toast.error("Provide at least one AMASI number")
        return
      }
      audience = { kind: "amasi_numbers", value: nums }
    }

    // Soft-confirm for "all" sends since they can reach 1000s of members.
    if (audienceKind === "all") {
      const ok = window.confirm(
        "This will notify every active member. Continue?"
      )
      if (!ok) return
    }

    setSubmitting(true)
    setLastResult(null)
    try {
      const res = await fetch("/api/admin/notifications/send-push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          image_url: imageUrl.trim() || null,
          action_url: actionUrl.trim() || null,
          audience,
          in_app_only: inAppOnly,
        }),
      })
      const json = (await res.json()) as SendResult
      setLastResult(json)
      if (json.status) {
        toast.success(
          `Sent to ${json.inbox_inserted ?? 0} member${json.inbox_inserted === 1 ? "" : "s"}`
        )
      } else {
        toast.error(json.message ?? "Send failed")
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      toast.error(`Send failed: ${msg}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container mx-auto max-w-3xl py-8">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Admin · Notifications
        </p>
        <h1 className="text-2xl font-bold flex items-center gap-2 mt-1">
          <Bell className="w-6 h-6" />
          Send Push Notification
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Composes one notification and dispatches it to the in-app inbox of every
          targeted member. Push delivery to phones fires automatically when FCM is
          configured server-side.
        </p>
      </div>

      <form onSubmit={handleSend} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message</CardTitle>
            <CardDescription>What members will see in their notification bell.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. AMASICON 2026 registration is open"
                maxLength={120}
                required
              />
              <p className="text-xs text-muted-foreground">
                {title.length}/120 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="body">Body</Label>
              <Textarea
                id="body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Short message — what the member needs to know and do."
                rows={4}
                maxLength={500}
                required
              />
              <p className="text-xs text-muted-foreground">
                {body.length}/500 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="action_url">Action URL (optional)</Label>
              <Input
                id="action_url"
                type="url"
                value={actionUrl}
                onChange={(e) => setActionUrl(e.target.value)}
                placeholder="https://membership.amasi.org/..."
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="image_url">Image URL (optional)</Label>
              <Input
                id="image_url"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audience</CardTitle>
            <CardDescription>Pick who receives this notification.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <AudienceTab
                active={audienceKind === "all"}
                icon={<Users className="w-4 h-4" />}
                label="All members"
                onClick={() => setAudienceKind("all")}
              />
              <AudienceTab
                active={audienceKind === "membership_type"}
                icon={<Tag className="w-4 h-4" />}
                label="By type"
                onClick={() => setAudienceKind("membership_type")}
              />
              <AudienceTab
                active={audienceKind === "zone"}
                icon={<MapPin className="w-4 h-4" />}
                label="By zone"
                onClick={() => setAudienceKind("zone")}
              />
              <AudienceTab
                active={audienceKind === "amasi_numbers"}
                icon={<Hash className="w-4 h-4" />}
                label="Specific"
                onClick={() => setAudienceKind("amasi_numbers")}
              />
            </div>

            {audienceKind === "membership_type" && (
              <div className="space-y-2">
                <Label>Membership type</Label>
                <div className="flex gap-2 flex-wrap">
                  {MEMBERSHIP_TYPES.map((t) => (
                    <Button
                      key={t}
                      type="button"
                      variant={membershipType === t ? "default" : "outline"}
                      size="sm"
                      onClick={() => setMembershipType(t)}
                    >
                      {t}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {audienceKind === "zone" && (
              <div className="space-y-2">
                <Label>Zone</Label>
                <div className="flex gap-2 flex-wrap">
                  {ZONES.map((z) => (
                    <Button
                      key={z}
                      type="button"
                      variant={zone === z ? "default" : "outline"}
                      size="sm"
                      onClick={() => setZone(z)}
                    >
                      {z}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {audienceKind === "amasi_numbers" && (
              <div className="space-y-2">
                <Label htmlFor="amasi_numbers">AMASI numbers (comma or space separated)</Label>
                <Textarea
                  id="amasi_numbers"
                  value={amasiNumbersInput}
                  onChange={(e) => setAmasiNumbersInput(e.target.value)}
                  placeholder="15632, 18460, 18283"
                  rows={3}
                />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={inAppOnly}
                onChange={(e) => setInAppOnly(e.target.checked)}
                className="rounded border-border"
              />
              <span>In-app inbox only (skip FCM push)</span>
            </label>

            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Sending...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" /> Send notification
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {lastResult && lastResult.status && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                Last send
                <Badge variant="secondary">{lastResult.broadcast_id?.slice(0, 8)}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Audience size</dt>
                <dd>{lastResult.audience_count ?? 0}</dd>
                <dt className="text-muted-foreground">Inbox rows inserted</dt>
                <dd>{lastResult.inbox_inserted ?? 0}</dd>
                <dt className="text-muted-foreground">Push attempted</dt>
                <dd>{lastResult.push?.attempted ?? 0}</dd>
                <dt className="text-muted-foreground">Push sent</dt>
                <dd>{lastResult.push?.sent ?? 0}</dd>
                <dt className="text-muted-foreground">Push failed</dt>
                <dd>{lastResult.push?.failed ?? 0}</dd>
                {lastResult.push?.skipped && (
                  <>
                    <dt className="text-muted-foreground">FCM</dt>
                    <dd className="text-muted-foreground">
                      not configured (in-app only)
                    </dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
        )}
      </form>
    </div>
  )
}

function AudienceTab({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-col items-center justify-center gap-1 py-3 rounded-md border text-sm transition-colors " +
        (active
          ? "border-foreground bg-accent text-accent-foreground"
          : "border-border hover:bg-accent")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}
