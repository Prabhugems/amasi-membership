import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"

const DEFAULT_DAYS = 30
const MAX_DAYS = 90
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

type DraftHit = {
  id: string
  email: string | null
  status: string | null
  updated_at: string | null
}

function clampInt(value: string | null, fallback: number, max: number): number {
  if (!value) return fallback
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(n, max)
}

// Webhook-only writes use a placeholder email when the payer's email is
// missing from notes; treat those as "no email" for the draft hint.
function isPlaceholderEmail(e: string | null | undefined): boolean {
  return !e || e.endsWith("@razorpay-webhook.invalid")
}

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const url = new URL(request.url)
  const days = clampInt(url.searchParams.get("days"), DEFAULT_DAYS, MAX_DAYS)
  const limit = clampInt(url.searchParams.get("limit"), DEFAULT_LIMIT, MAX_LIMIT)
  const countOnly = url.searchParams.get("count") === "1"

  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const supabase = createAdminClient()

  // Cheap path for the sidebar badge: skip the draft-correlation joins and
  // return only the count. Polled every 60s per admin session.
  if (countOnly) {
    const { count, error: countError } = await supabase
      .from("membership_payments")
      .select("id", { count: "exact", head: true })
      .is("application_id", null)
      .eq("status", "paid")
      .gte("created_at", sinceIso)

    if (countError) {
      console.error("[admin/orphan-payments] count error:", countError)
      return Response.json(
        { status: false, message: "Failed to count orphan payments" },
        { status: 500 }
      )
    }

    return Response.json({
      status: true,
      total: count ?? 0,
      lookback_days: days,
    })
  }

  const { data: orphans, error } = await supabase
    .from("membership_payments")
    .select(
      "id, gateway_payment_id, gateway_order_id, amount, currency, member_email, created_at"
    )
    .is("application_id", null)
    .eq("status", "paid")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) {
    console.error("[admin/orphan-payments] query error:", error)
    return Response.json(
      { status: false, message: "Failed to load orphan payments" },
      { status: 500 }
    )
  }

  const rows = orphans ?? []

  // Build the draft-hint set by email only. Two prior schema-drift bugs
  // hit this endpoint: (a) selecting membership_payments.reference_number
  // (fixed 2026-05-25, that column never existed on that table); (b) the
  // draft-side select below still asked for draft_applications.reference_number,
  // which also doesn't exist — the request 400'd silently and admins saw no
  // orphan hints. Both are aligned with the real schema now; email-match was
  // always the only path that produced hits.
  const emails = Array.from(
    new Set(
      rows
        .map((r) => r.member_email)
        .filter((e): e is string => !isPlaceholderEmail(e))
        .map((e) => e.toLowerCase())
    )
  )

  const byEmail = emails.length
    ? await supabase
        .from("draft_applications")
        .select("id, email, status, updated_at")
        .in("email", emails)
    : null

  // Email can collide across drafts (no unique constraint); keep the most
  // recent and flag whether multiple matched so admins know the hint is fuzzy.
  const emailMap = new Map<string, { hit: DraftHit; count: number }>()
  for (const d of ((byEmail?.data ?? []) as DraftHit[])) {
    const key = d.email?.toLowerCase()
    if (!key) continue
    const existing = emailMap.get(key)
    if (!existing) {
      emailMap.set(key, { hit: d, count: 1 })
    } else {
      const newer =
        (d.updated_at ?? "") > (existing.hit.updated_at ?? "") ? d : existing.hit
      emailMap.set(key, { hit: newer, count: existing.count + 1 })
    }
  }

  const data = rows.map((r) => {
    const emailKey = !isPlaceholderEmail(r.member_email)
      ? r.member_email!.toLowerCase()
      : null
    const emailEntry = emailKey ? emailMap.get(emailKey) : undefined

    let draft_hint:
      | {
          draft_id: string
          draft_status: string | null
          match_source: "email"
          email_match_count?: number
        }
      | null = null

    if (emailEntry) {
      draft_hint = {
        draft_id: emailEntry.hit.id,
        draft_status: emailEntry.hit.status,
        match_source: "email",
        email_match_count: emailEntry.count,
      }
    }

    return {
      id: r.id,
      gateway_payment_id: r.gateway_payment_id,
      gateway_order_id: r.gateway_order_id,
      amount: r.amount,
      currency: r.currency,
      member_email: r.member_email,
      created_at: r.created_at,
      draft_hint,
    }
  })

  return Response.json({
    status: true,
    data,
    total: data.length,
    lookback_days: days,
    limit,
  })
}
