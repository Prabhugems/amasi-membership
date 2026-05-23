// @auth: public — Razorpay client callback after checkout; integrity verified
// inline via HMAC-SHA256 of "order_id|payment_id" against razorpay_signature
// using RAZORPAY_KEY_SECRET. No user session required (applicant hasn't been
// approved yet).
import { NextRequest } from "next/server"
import crypto from "crypto"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { recordStepEvent } from "@/lib/funnel-tracking"
import { validateRequiredDocuments } from "@/lib/document-keys"
import { getMembershipType } from "@/lib/membership-types"

// Razorpay orders.fetch + payments.transfer fallback can exceed 15s Vercel default.
export const maxDuration = 30

// Shape of the JSON body posted by the /apply checkout handler. All optional
// because they originate from a client-controlled payload and are validated
// individually below (signature + required-field checks).
interface VerifyBody {
  razorpay_order_id?: string
  razorpay_payment_id?: string
  razorpay_signature?: string
  referenceNumber?: string
  applicationId?: string
  amount?: number
  currency?: string
  email?: string
  membershipType?: string
}

// Razorpay SDK gap: `payments.transfer(paymentId, params)` is a documented
// runtime method (Razorpay Route — split a captured payment) but the SDK's
// TS types don't declare it. We use this contained shape for the call site.
// `notes` values may be undefined — Razorpay drops undefined fields at JSON
// serialization, matching the pre-typed behavior.
type PaymentsWithTransfer = {
  transfer: (
    paymentId: string,
    params: {
      transfers: Array<{
        account: string
        amount: number
        currency: string
        notes?: Record<string, string | undefined>
      }>
    },
  ) => Promise<unknown>
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`payment-verify:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const body = (await request.json()) as VerifyBody
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      referenceNumber,
      applicationId,
      amount,
      currency,
      email,
      membershipType,
    } = body

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return Response.json({ status: false, message: "Payment details missing" }, { status: 400 })
    }

    // Verify signature
    const signatureBody = razorpay_order_id + "|" + razorpay_payment_id
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!.trim())
      .update(signatureBody)
      .digest("hex")

    if (expectedSignature !== razorpay_signature) {
      console.error("Payment signature mismatch")
      return Response.json({ status: false, message: "Payment verification failed" }, { status: 400 })
    }

    // Processing fee calculation
    const isILM = membershipType?.toUpperCase() === "ILM"
    const PROCESSING_FEE = isILM ? 0 : (Number(process.env.PROCESSING_FEE_INR) || 100)

    // Transfer is now handled at order creation (create-order route).
    // This verify route only logs the status — check the order for transfer details.
    let transferStatus: "success" | "failed" | "skipped" = "skipped"
    let transferError: string | null = null

    if (PROCESSING_FEE > 0) {
      try {
        const Razorpay = (await import("razorpay")).default
        const razorpay = new Razorpay({
          key_id: process.env.RAZORPAY_KEY_ID!.trim(),
          key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
        })

        // Check if transfer was included in the order
        const order = await razorpay.orders.fetch(razorpay_order_id)
        // Razorpay SDK type doesn't include `transfers` on the fetched order,
        // but the runtime payload does when the order was created with one.
        const orderWithTransfers = order as { transfers?: { items?: unknown[] } }
        if ((orderWithTransfers.transfers?.items?.length ?? 0) > 0) {
          transferStatus = "success"
          console.log(`Route transfer via order: ₹${PROCESSING_FEE} for ${referenceNumber}`)
        } else {
          // Fallback: try payment-level transfer
          const EVENTS360_ACCOUNT_ID = process.env.EVENTS360_RAZORPAY_ACCOUNT_ID || "acc_SYV3ZpQvinGqOW"
          try {
            await (razorpay.payments as unknown as PaymentsWithTransfer).transfer(razorpay_payment_id, {
              transfers: [{
                account: EVENTS360_ACCOUNT_ID,
                amount: PROCESSING_FEE * 100,
                currency: "INR",
                notes: { reference: referenceNumber, purpose: "processing_fee" },
              }],
            })
            transferStatus = "success"
            console.log(`Route transfer via payment fallback: ₹${PROCESSING_FEE} for ${referenceNumber}`)
          } catch (fallbackErr) {
            const fbErr = fallbackErr as { error?: { description?: string; code?: string }; message?: string }
            transferStatus = "failed"
            transferError = fbErr?.error?.description || fbErr?.message || "Unknown error"
            console.error(`Route transfer FAILED for ${referenceNumber}:`, JSON.stringify({
              error: transferError,
              code: fbErr?.error?.code,
              paymentId: razorpay_payment_id,
              amount: PROCESSING_FEE,
            }))
          }
        }
      } catch (checkErr) {
        const cErr = checkErr as { message?: string }
        transferStatus = "failed"
        transferError = cErr?.message || "Could not verify transfer"
        console.error(`Route transfer check error for ${referenceNumber}:`, cErr?.message)
      }
    }

    const supabase = createAdminClient()

    // Dedup check — prevent double-recording the same payment.
    //
    // A race exists between this client-side verify call and the Razorpay
    // webhook (`/api/webhooks/razorpay`). The webhook can land FIRST and
    // insert a `membership_payments` row before this route runs (especially
    // on payment-link captures or slow client networks). In that case the
    // webhook-written row has no `application_id` (the webhook doesn't have
    // it — only the client does), so if we early-return here, the
    // application's `payment_status` is never flipped to 'paid' and the
    // applicant looks unpaid in admin.
    //
    // Fix: if the existing row is already linked to *this* application AND
    // the application is already marked paid, the early return is correct
    // (true idempotency). Otherwise, fall through to backfill the link.
    const { data: existingPayment } = await supabase
      .from("membership_payments")
      .select("id, application_id")
      .eq("gateway_payment_id", razorpay_payment_id)
      .limit(1)
      .maybeSingle()

    let skipPaymentInsert = false
    if (existingPayment) {
      // Check whether this is a genuine idempotent retry (both sides linked)
      // vs. a webhook-first race that needs backfill.
      let applicationPaid = false
      if (applicationId) {
        const { data: appRow } = await supabase
          .from("membership_applications")
          .select("payment_status")
          .eq("id", applicationId)
          .maybeSingle()
        applicationPaid = appRow?.payment_status === "paid"
      }
      if (existingPayment.application_id && applicationPaid) {
        return Response.json({ status: true, message: "Payment already recorded", paymentId: razorpay_payment_id })
      }
      // Webhook-first race: keep going so the application gets linked, but
      // skip the duplicate `membership_payments` insert.
      skipPaymentInsert = true
      Sentry.captureMessage(
        `[payments/verify] webhook-first race detected for ${razorpay_payment_id} — backfilling application_id on existing payment row`,
        {
          level: "info",
          tags: { flow: "payment_verify", reason: "webhook_first_race" },
          extra: {
            razorpay_payment_id,
            razorpay_order_id,
            referenceNumber,
            applicationId: applicationId || null,
            existing_payment_id: existingPayment.id,
            existing_application_id: existingPayment.application_id,
          },
        },
      )
    }

    // --- Defense-in-depth: re-check that documents are still valid at verify time ---
    // create-order already gates this; this branch should only fire on a contract
    // violation (race, stale client, direct API hit). When it does, the money has
    // already moved — we record the payment but flag the draft so admins can refund.
    let paidButBroken = false
    if (email && membershipType) {
      const emailKey = email.toLowerCase().trim()
      const typeKey = (membershipType as string).toUpperCase()
      const { data: draftRow } = await supabase
        .from("draft_applications")
        .select("id, step_data")
        .eq("email", emailKey)
        .eq("membership_type", typeKey)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      const draftStepData = draftRow?.step_data as { uploads?: Record<string, unknown> } | null
      const draftUploads = draftStepData?.uploads || null
      const membershipTypeConfig = getMembershipType(typeKey)
      const docCheck = membershipTypeConfig && draftUploads
        ? validateRequiredDocuments(draftUploads, membershipTypeConfig.requiredDocs)
        : { valid: false as const, reason: "documents_incomplete" as const, missing: [] as string[] }

      if (!docCheck.valid) {
        paidButBroken = true
        Sentry.captureMessage(
          `[paid_but_broken] Razorpay payment ${razorpay_payment_id} captured for ${emailKey} (${typeKey}) but documents failed validation at verify time`,
          {
            level: "fatal",
            tags: { flow: "payment_verify", severity: "fatal", reason: "paid_but_broken" },
            extra: {
              razorpay_order_id,
              razorpay_payment_id,
              referenceNumber,
              email: emailKey,
              membershipType: typeKey,
              missing_documents: docCheck.missing,
              draft_id: draftRow?.id || null,
            },
          },
        )
        if (draftRow?.id) {
          await supabase
            .from("draft_applications")
            .update({
              failure_reason: "paid_but_broken",
              failure_step: 5,
              status: "stuck",
              updated_at: new Date().toISOString(),
            })
            .eq("id", draftRow.id)
        }
      }
    }

    // Record payment (or backfill application_id on a webhook-first race).
    if (!skipPaymentInsert) {
      // Upsert (not insert) so a concurrent webhook landing first is
      // absorbed by the DB unique index on gateway_payment_id rather
      // than this writer hitting a constraint violation.
      const { error: insertError } = await supabase.from("membership_payments").upsert({
        application_id: applicationId || null,
        member_email: email || referenceNumber, // using as reference tracker
        gateway_order_id: razorpay_order_id,
        gateway_payment_id: razorpay_payment_id,
        gateway_signature: razorpay_signature,
        payment_gateway: "razorpay",
        status: "paid",
        amount: amount || null,
        currency: currency || "INR",
        fee_breakdown: {
          membership_fee: (amount || 4230) - PROCESSING_FEE,
          processing_fee: PROCESSING_FEE,
          processing_fee_account: PROCESSING_FEE > 0 ? "events360" : null,
          transfer_status: transferStatus,
          transfer_error: transferError,
          note: PROCESSING_FEE > 0 ? "₹100 processing fee (incl GST) to be settled to Events 360" : "No processing fee for ILM",
          applicant_email: email || null,
        },
      }, { onConflict: "gateway_payment_id", ignoreDuplicates: true })

      if (insertError) {
        console.error("Payment insert error:", insertError)
        // Surface to Sentry so a silently-failing verify doesn't disappear into
        // logs. Razorpay has the money; our DB doesn't. Triage the orphan via
        // the reconciliation cron OR manual recovery (kilroy 2026-05-21 case).
        Sentry.captureException(insertError, {
          level: "fatal",
          tags: { flow: "payment_verify", op: "membership-payments-insert", severity: "fatal" },
          extra: { razorpay_payment_id, razorpay_order_id, referenceNumber, applicationId },
        })
        return Response.json({ status: false, message: "Failed to record payment" }, { status: 500 })
      }
    } else if (existingPayment) {
      // Backfill the application_id (and member_email) on the webhook-written
      // row. Guard with `.is("application_id", null)` so we don't clobber a
      // legitimate prior link from a different applicant (defense in depth —
      // gateway_payment_id is already globally unique).
      const { error: backfillError } = await supabase
        .from("membership_payments")
        .update({
          application_id: applicationId || null,
          member_email: email || referenceNumber,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingPayment.id)
        .is("application_id", null)
      if (backfillError) {
        console.error("Payment backfill error:", backfillError)
        Sentry.captureException(backfillError, {
          tags: { flow: "payment_verify", op: "webhook_race_backfill" },
          extra: { existing_payment_id: existingPayment.id, applicationId },
        })
      }
    }

    // Update application payment status
    if (applicationId) {
      const { error: updateError } = await supabase
        .from("membership_applications")
        .update({
          payment_status: "paid",
          payment_id: razorpay_payment_id,
          payment_amount: amount || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", applicationId)

      if (updateError) {
        // Critical silent-failure case: payment is recorded but the application
        // stays with payment_status='pending'. Admin sees the applicant in
        // /pending without the "Payment Received" badge, applicant looks
        // unpaid. Surface to Sentry so this doesn't sit unnoticed.
        console.error("Application payment status update error:", updateError)
        Sentry.captureException(updateError, {
          level: "error",
          tags: { flow: "payment_verify", op: "application-payment-status-update", severity: "high" },
          extra: { razorpay_payment_id, applicationId, referenceNumber },
        })
      }
    } else {
      // No applicationId on a verify call means the client never created an
      // application row (or lost track of it) before paying. Payment is
      // recorded but unlinked — the row sits orphan in membership_payments
      // until the reconciliation cron or a manual recovery picks it up.
      // This is the dropped-verify-callback pattern from kilroy 2026-05-21.
      Sentry.captureMessage(
        "[payments/verify] called without applicationId — payment recorded but unlinked",
        {
          level: "warning",
          tags: { flow: "payment_verify", reason: "missing_application_id" },
          extra: { razorpay_payment_id, razorpay_order_id, referenceNumber, email },
        }
      )
    }

    void recordStepEvent({
      email: email || "",
      applicationId: applicationId || null,
      eventType: "payment",
      step: 5,
      status: "captured",
      metadata: {
        gateway: "razorpay",
        gateway_payment_id: razorpay_payment_id,
        gateway_order_id: razorpay_order_id,
        amount,
        currency: currency || "INR",
      },
    }, supabase)

    return Response.json({
      status: true,
      message: "Payment verified successfully",
      paymentId: razorpay_payment_id,
      paidButBroken,
    })
  } catch (error) {
    console.error("Payment verify error:", error)
    Sentry.captureException(error, { tags: { flow: "payment_verify" } })
    return Response.json({ status: false, message: "Payment verification failed" }, { status: 500 })
  }
}
