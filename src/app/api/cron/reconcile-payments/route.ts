// Hourly cron: cross-references Razorpay-captured payments against
// `membership_payments` and recovers any rows that the verify callback or
// webhook dropped. Without this, a missed webhook leaves the applicant in
// limbo — they paid Razorpay but our DB never recorded it, so the application
// sits in `submitted` with `payment_status='pending'` forever.
//
// Auth: Bearer CRON_SECRET (Vercel cron) OR super_admin session (manual run).
// Schedule: `7 * * * *` in vercel.json — every hour, staggered from the
// other crons (sla-breach :*/10, sync-members :0, weekly-digest Mon :04,
// bulk-draft-reminders :30, cleanup-drafts :35).
//
// Idempotency: upsert on gateway_payment_id with ignoreDuplicates=true.
// The unique index on `membership_payments.gateway_payment_id` is the
// authoritative dedup boundary — re-running the cron is safe.
//
// What v1 does NOT do: auto-approve the application. The webhook's
// recovery branch does that on payment.captured events; the cron only
// records the missing payment so the admin sees it in /pending and can
// click approve manually. Auto-approval from the cron is a follow-up
// once we've watched a few reconciliation cycles in prod.
import { NextRequest } from "next/server"
import Razorpay from "razorpay"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"

// Razorpay list + sequential order fetches — well over the 15s default.
export const maxDuration = 60

interface ReconcileAction {
  payment_id: string
  order_id: string | null
  amount: number
  member_email: string
  reference_number: string | null
  linked_application_id: string | null
  application_status: string | null
  inserted: boolean
  application_marked_paid: boolean
  error?: string
}

interface RazorpayPayment {
  id: string
  status: string
  order_id: string | null
  amount: number
  currency: string
  email?: string
}

interface RazorpayOrderNotes {
  reference_number?: string
  email?: string
}

export async function GET(request: NextRequest) {
  // Auth: same pattern as cleanup-drafts cron.
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  const url = new URL(request.url)
  const dryRun = url.searchParams.get("dryRun") === "true"
  const hours = Math.max(
    1,
    Math.min(72, parseInt(url.searchParams.get("hours") || "6", 10) || 6)
  )
  const fromTs = Math.floor((Date.now() - hours * 3600 * 1000) / 1000)

  const keyId = process.env.RAZORPAY_KEY_ID?.trim()
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim()
  if (!keyId || !keySecret) {
    return Response.json(
      { status: false, error: "RAZORPAY_KEY_ID/SECRET not configured" },
      { status: 500 }
    )
  }

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret })
  const supabase = createAdminClient()

  // 1. Fetch recent payments from Razorpay (captured only).
  let payments: RazorpayPayment[] = []
  try {
    const resp = await razorpay.payments.all({ from: fromTs, count: 100 })
    payments = (resp.items || []) as RazorpayPayment[]
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "cron/reconcile-payments", op: "razorpay-list" },
      extra: { fromTs, hours },
    })
    return Response.json(
      { status: false, error: "Razorpay list failed" },
      { status: 502 }
    )
  }

  const captured = payments.filter((p) => p.status === "captured")
  const capturedIds = captured.map((p) => p.id)

  // 2. Find which captured payments are missing from our DB.
  let existingIds = new Set<string>()
  if (capturedIds.length > 0) {
    const { data: existing, error: lookupErr } = await supabase
      .from("membership_payments")
      .select("gateway_payment_id")
      .in("gateway_payment_id", capturedIds)
    if (lookupErr) {
      Sentry.captureException(lookupErr, {
        tags: { route: "cron/reconcile-payments", op: "existing-lookup" },
      })
      return Response.json(
        { status: false, error: "DB lookup failed" },
        { status: 500 }
      )
    }
    existingIds = new Set(
      (existing || []).map((r) => r.gateway_payment_id as string)
    )
  }

  const missing = captured.filter((p) => !existingIds.has(p.id))

  const actions: ReconcileAction[] = []
  let reconciled = 0
  let applicationsLinked = 0

  // 3. For each missing payment, mirror the webhook payment.captured logic.
  for (const p of missing) {
    let referenceNumber: string | null = null
    let memberEmail: string | null = null

    // Fetch order notes (reference_number + email) when the payment has an order_id.
    if (p.order_id) {
      try {
        const order = await razorpay.orders.fetch(p.order_id)
        const notes = (order.notes as RazorpayOrderNotes | undefined) || {}
        if (typeof notes.reference_number === "string") {
          referenceNumber = notes.reference_number
        }
        if (typeof notes.email === "string" && notes.email.trim()) {
          memberEmail = notes.email.toLowerCase().trim()
        }
      } catch (err) {
        Sentry.captureException(err, {
          tags: { route: "cron/reconcile-payments", op: "order-fetch" },
          extra: { paymentId: p.id, orderId: p.order_id },
        })
      }
    }

    // Application lookup by reference_number (canonical email source).
    let appId: string | null = null
    let appStatus: string | null = null
    if (referenceNumber) {
      const { data: appRow } = await supabase
        .from("membership_applications")
        .select("id, email, status, payment_status")
        .eq("reference_number", referenceNumber)
        .maybeSingle()
      if (appRow) {
        appId = appRow.id as string
        appStatus = (appRow.status as string | null) ?? null
        if (appRow.email && typeof appRow.email === "string") {
          memberEmail = (appRow.email as string).toLowerCase().trim()
        }
      }
    }

    // Fallback chain identical to the webhook (payment.email → placeholder).
    if (!memberEmail && typeof p.email === "string" && p.email.trim()) {
      memberEmail = p.email.toLowerCase().trim()
    }
    if (!memberEmail) {
      memberEmail = `unknown-${p.id}@razorpay-reconcile.invalid`
    }

    const action: ReconcileAction = {
      payment_id: p.id,
      order_id: p.order_id,
      amount: p.amount / 100,
      member_email: memberEmail,
      reference_number: referenceNumber,
      linked_application_id: appId,
      application_status: appStatus,
      inserted: false,
      application_marked_paid: false,
    }

    if (dryRun) {
      actions.push(action)
      continue
    }

    // Insert payment row (upsert is the dedup boundary even though we already
    // filtered by gateway_payment_id above — a concurrent webhook racing the
    // cron must still land cleanly).
    const { error: payErr } = await supabase
      .from("membership_payments")
      .upsert(
        {
          member_email: memberEmail,
          gateway_order_id: p.order_id,
          gateway_payment_id: p.id,
          payment_gateway: "razorpay",
          status: "paid",
          amount: p.amount / 100,
          currency: p.currency || "INR",
          application_id: appId,
        },
        { onConflict: "gateway_payment_id", ignoreDuplicates: true }
      )

    if (payErr) {
      action.error = `payment-insert: ${payErr.message}`
      Sentry.captureException(payErr, {
        tags: { route: "cron/reconcile-payments", op: "payment-insert" },
        extra: { paymentId: p.id, orderId: p.order_id, referenceNumber },
      })
      actions.push(action)
      continue
    }

    action.inserted = true
    reconciled++

    // Mark the linked application as paid so admin sees it in /pending with
    // a green payment badge and can approve.
    if (referenceNumber && appId) {
      const { error: appErr } = await supabase
        .from("membership_applications")
        .update({
          payment_status: "paid",
          payment_id: p.id,
          payment_amount: p.amount / 100,
          updated_at: new Date().toISOString(),
        })
        .eq("reference_number", referenceNumber)
        .eq("payment_status", "pending")

      if (appErr) {
        Sentry.captureException(appErr, {
          tags: {
            route: "cron/reconcile-payments",
            op: "app-payment-status",
          },
          extra: { paymentId: p.id, referenceNumber },
        })
      } else {
        action.application_marked_paid = true
        applicationsLinked++
      }
    }

    // Per-reconciliation Sentry breadcrumb so admins see the recovery in the
    // dashboard. Warning-level so it groups but doesn't page.
    Sentry.captureMessage("Payment reconciled from Razorpay", {
      level: "warning",
      tags: {
        route: "cron/reconcile-payments",
        reason: "missed_webhook",
      },
      extra: {
        paymentId: p.id,
        orderId: p.order_id,
        referenceNumber,
        memberEmail,
        amount: p.amount / 100,
        application_marked_paid: action.application_marked_paid,
      },
    })

    actions.push(action)
  }

  const summary = {
    status: true,
    dry_run: dryRun,
    lookback_hours: hours,
    razorpay_captured_scanned: captured.length,
    already_in_db: captured.length - missing.length,
    missing_from_db: missing.length,
    reconciled,
    applications_marked_paid: applicationsLinked,
    actions,
  }

  // Summary-level Sentry message only if anything was actually recovered.
  // Silent runs (the steady-state expected case) leave no Sentry trail.
  if (!dryRun && reconciled > 0) {
    Sentry.captureMessage(
      `Reconciliation cron recovered ${reconciled} missed payment(s)`,
      {
        level: "info",
        tags: { route: "cron/reconcile-payments" },
        extra: summary,
      }
    )
  }

  return Response.json(summary)
}
