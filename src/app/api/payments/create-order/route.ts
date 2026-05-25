// @auth: public — applicant creates a Razorpay order during /apply, before
// approval and before a member session exists. Amount is validated against
// the server-side MEMBERSHIP_FEES table; rate-limited per IP.
import { NextRequest } from "next/server"
import Razorpay from "razorpay"
import * as Sentry from "@sentry/nextjs"
import { checkRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase"
import { validateRequiredDocuments, lookupDocumentLabel } from "@/lib/document-keys"
import { getMembershipType } from "@/lib/membership-types"

// Observation-only: when the document gate refuses to mint an order, this
// helper detects the "OCR succeeded but uploads is empty" mismatch (the
// docmanjir@gmail.com 2026-05-22 case) and pages Sentry at fatal severity.
// It NEVER throws back into the request flow and NEVER changes the response.
async function alertIfPaidPathBlockedByLostUploads(args: {
  supabase: ReturnType<typeof createAdminClient>
  emailKey: string
  typeKey: string
  draftId: string | null
  draftUploads: Record<string, unknown> | null
  requiredDocs: string[]
  rejectionReason: string
}): Promise<void> {
  try {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const { data: events } = await args.supabase
      .from("application_step_events")
      .select("metadata, created_at")
      .eq("email", args.emailKey)
      .eq("event_type", "doc_upload")
      .eq("status", "extracted")
      .gte("created_at", oneHourAgo)
      .order("created_at", { ascending: false })
      .limit(50)

    if (!events || events.length === 0) return

    const extractedDocTypes = new Set<string>()
    for (const ev of events) {
      const md = (ev as { metadata?: { docType?: unknown } | null }).metadata
      const docType = md && typeof md.docType === "string" ? md.docType : null
      if (docType) extractedDocTypes.add(docType)
    }

    const requiredNonProfile = args.requiredDocs.filter((d) => d !== "profile")
    const uploadsKeys = args.draftUploads
      ? new Set(Object.keys(args.draftUploads))
      : new Set<string>()
    const extractedButMissing = [...extractedDocTypes].filter(
      (d) => requiredNonProfile.includes(d) && !uploadsKeys.has(d),
    )

    // Only fire on concrete evidence: a required doc was OCR-extracted on
    // record but is not present in the draft's persisted uploads. Without
    // this guard the alarm would fire on ordinary "user hasn't uploaded
    // yet" rejections and lose signal.
    if (extractedButMissing.length === 0) return

    Sentry.captureMessage(
      "paid_path_blocked_by_lost_uploads: extracted docs missing from draft.step_data.uploads",
      {
        level: "fatal",
        fingerprint: ["paid-path-blocked-by-lost-uploads"],
        tags: {
          component: "payments/create-order",
          reason: "paid_path_blocked_by_lost_uploads",
          membership_type: args.typeKey,
          rejection_reason: args.rejectionReason,
        },
        extra: {
          applicant_email: args.emailKey,
          draft_id: args.draftId,
          membership_type: args.typeKey,
          required_docs: requiredNonProfile,
          uploads_keys: [...uploadsKeys],
          extracted_doc_types: [...extractedDocTypes],
          extracted_but_missing_from_uploads: extractedButMissing,
          extracted_events_count: events.length,
        },
      },
    )
  } catch {
    // Observability must never break the payment path.
  }
}

// Razorpay SDK with potential retry-without-transfer fallback.
export const maxDuration = 20

// Local shape for the order-creation payload. The Razorpay TS types do NOT
// declare the `transfers` field on orders.create's argument, but the runtime
// HTTP API accepts and acts on it (Razorpay Route). We keep our payload
// strongly typed here and use a contained cast at the SDK call site.
interface OrderPayload {
  amount: number
  currency: string
  receipt: string
  partial_payment: false
  notes: Record<string, string | undefined>
  transfers?: Array<{
    account: string
    amount: number
    currency: string
    notes: Record<string, string>
    on_hold: 0
  }>
}

// Minimal subset of Razorpay's order response we forward to the client.
// The SDK's `Orders.RazorpayOrder` lives behind a deep import path; we
// avoid that and only type the three fields we actually read below.
// `amount` is `number | string` per Razorpay's API (string in some SDK
// versions, number in others — match both to stay forward-compatible).
interface CreatedOrder {
  id: string
  amount: number | string
  currency: string
}

// Server-side fee lookup — source of truth for membership fees
const MEMBERSHIP_FEES: Record<string, { amount: number; currency: string }> = {
  LM:  { amount: 4230, currency: "INR" },
  ALM: { amount: 4230, currency: "INR" },
  ACM: { amount: 4230, currency: "INR" },
  ILM: { amount: 300,  currency: "USD" },
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`create-order:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const { amount, currency, referenceNumber, email, name, membershipType } = await request.json()

    if (!amount || !referenceNumber) {
      return Response.json({ status: false, message: "Amount and reference number required" }, { status: 400 })
    }

    // Validate membership type and amount
    const expectedFee = MEMBERSHIP_FEES[membershipType?.toUpperCase()]
    if (!expectedFee) {
      return Response.json({ status: false, message: "Invalid membership type" }, { status: 400 })
    }
    if (amount !== expectedFee.amount) {
      return Response.json({ status: false, message: `Invalid amount for ${membershipType} membership. Expected ${expectedFee.amount}` }, { status: 400 })
    }

    const expectedCurrency = expectedFee.currency
    if (currency && currency !== expectedCurrency) {
      return Response.json({ status: false, message: `Invalid currency for ${membershipType}. Expected ${expectedCurrency}` }, { status: 400 })
    }

    // Document gate + duplicate-payment guard. Both require email; a missing
    // email at this stage is itself a programming error worth surfacing.
    if (!email) {
      return Response.json({ status: false, message: "Email required to initiate payment" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const emailKey = email.toLowerCase().trim()
    const typeKey = membershipType.toUpperCase()

    // --- Document gate: refuse to create the order if required docs aren't OCR-verified ---
    // Source of truth is `draft_applications.step_data.uploads` (server-side state) — NOT
    // the client request body, which would be trivially spoofable. The client saves the
    // draft via /api/applications/save-draft before reaching this endpoint.
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
    const draftId = (draftRow as { id?: string } | null)?.id ?? null
    const membershipTypeConfig = getMembershipType(typeKey)
    if (!membershipTypeConfig) {
      return Response.json({ status: false, message: "Unknown membership type" }, { status: 400 })
    }
    if (!draftUploads) {
      await alertIfPaidPathBlockedByLostUploads({
        supabase,
        emailKey,
        typeKey,
        draftId,
        draftUploads: null,
        requiredDocs: membershipTypeConfig.requiredDocs,
        rejectionReason: "no_draft_uploads",
      })
      return Response.json({
        status: false,
        error: "documents_incomplete",
        missing: membershipTypeConfig.requiredDocs.filter(d => d !== "profile"),
        message: "Please upload your documents before proceeding to payment.",
      }, { status: 400 })
    }
    // PR 0: validateRequiredDocuments accepts manual-review bypass docs as
    // valid (status='uploaded' + bypass=true + fileUrl). The bypass list in
    // docCheck.bypassedDocs is intentionally NOT consulted here — payment
    // flow is unchanged regardless of how the doc passed the gate. The
    // submit route is the place where bypass docs force needs_manual_review;
    // see src/lib/document-keys.ts for the canonical rule and the three
    // call sites that share it.
    const docCheck = validateRequiredDocuments(draftUploads, membershipTypeConfig.requiredDocs)
    if (!docCheck.valid) {
      await alertIfPaidPathBlockedByLostUploads({
        supabase,
        emailKey,
        typeKey,
        draftId,
        draftUploads,
        requiredDocs: membershipTypeConfig.requiredDocs,
        rejectionReason: docCheck.reason,
      })
      return Response.json({
        status: false,
        error: docCheck.reason,
        missing: docCheck.missing,
        message: `These documents need a clearer upload before payment: ${docCheck.missing.map(lookupDocumentLabel).join(", ")}.`,
      }, { status: 400 })
    }

    // Duplicate-payment guard: a user whose phone died post-payment could return
    // and pay a second time if we don't check. Block new orders when the same
    // email already has a paid draft OR a submitted-and-not-rejected application
    // for the same membership type.
    const { data: paidDraft } = await supabase
      .from("draft_applications")
      .select("id, current_step")
      .eq("email", emailKey)
      .eq("membership_type", typeKey)
      .eq("has_verified_payment", true)
      .limit(1)
      .maybeSingle()

    if (paidDraft) {
      return Response.json(
        {
          status: false,
          code: "DUPLICATE_PAYMENT",
          message: "You have already paid for this application. Please refresh the page and complete your submission instead of paying again.",
          draftId: paidDraft.id,
        },
        { status: 409 }
      )
    }

    const { data: existingApp } = await supabase
      .from("membership_applications")
      .select("id, reference_number, status")
      .eq("email", emailKey)
      .eq("membership_type", typeKey)
      .eq("payment_status", "paid")
      .not("status", "in", '("rejected")')
      .limit(1)
      .maybeSingle()

    if (existingApp) {
      return Response.json(
        {
          status: false,
          code: "DUPLICATE_PAYMENT",
          message: `You have already submitted and paid for a ${typeKey} application (${existingApp.reference_number}). Please check your application status instead.`,
          referenceNumber: existingApp.reference_number,
        },
        { status: 409 }
      )
    }

    // Orphan-payment guard: a paid membership_payments row already exists
    // for this email but isn't linked to a submitted application yet — the
    // "paid before submit" pattern (Choudhary 2026-05-25 recovery). Without
    // this guard the applicant can mint a second order and pay twice.
    // Block on the most-recent orphan; tell them to contact support rather
    // than re-pay. Does NOT auto-trigger linking — manual recovery via
    // /api/payments/lookup or a per-applicant script remains the path.
    const { data: orphanPayment } = await supabase
      .from("membership_payments")
      .select("gateway_payment_id, gateway_order_id, amount, currency, created_at")
      .ilike("member_email", emailKey)
      .eq("status", "paid")
      .is("application_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (orphanPayment) {
      const currencySymbol = orphanPayment.currency === "USD" ? "$" : "₹"
      const paidAt = new Date(orphanPayment.created_at as string)
      const dateDisplay = paidAt.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
      Sentry.captureMessage("Orphan paid-payment block on create-order", {
        level: "warning",
        fingerprint: ["create-order", "orphan-paid-block"],
        tags: {
          component: "create-order",
          reason: "orphan_paid_block",
        },
        extra: {
          applicant_email: emailKey,
          orphan_gateway_payment_id: orphanPayment.gateway_payment_id,
          orphan_gateway_order_id: orphanPayment.gateway_order_id,
          orphan_amount: orphanPayment.amount,
          orphan_currency: orphanPayment.currency,
          orphan_created_at: orphanPayment.created_at,
          attempted_membership_type: typeKey,
        },
      })
      return Response.json(
        {
          status: false,
          code: "PAID_UNLINKED",
          message:
            `We've already received a payment from this email, but it isn't ` +
            `linked to a submitted application yet. Payment received: ` +
            `${currencySymbol}${orphanPayment.amount} on ${dateDisplay} ` +
            `(ID ${orphanPayment.gateway_payment_id}). Please do NOT pay ` +
            `again — email support@amasi.org with this payment ID and ` +
            `we'll link it to your application.`,
          paymentId: orphanPayment.gateway_payment_id,
          paidAt: orphanPayment.created_at,
          amount: orphanPayment.amount,
          currency: orphanPayment.currency,
        },
        { status: 409 },
      )
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID!.trim(),
      key_secret: process.env.RAZORPAY_KEY_SECRET!.trim(),
    })

    // Processing fee transfer to Events360 (INR only, skip for ILM)
    const isILM = membershipType?.toUpperCase() === "ILM"
    const PROCESSING_FEE = isILM ? 0 : (Number(process.env.PROCESSING_FEE_INR) || 100)
    const EVENTS360_ACCOUNT_ID = process.env.EVENTS360_RAZORPAY_ACCOUNT_ID || "acc_SYV3ZpQvinGqOW"

    const orderPayload: OrderPayload = {
      amount: Math.round(amount * 100), // Razorpay expects paise/cents
      currency: currency || "INR",
      receipt: referenceNumber,
      partial_payment: false,
      notes: {
        reference_number: referenceNumber,
        email,
        name,
        membership_type: membershipType,
      },
    }

    // Include transfer at order creation (Razorpay recommended approach)
    if (PROCESSING_FEE > 0) {
      orderPayload.transfers = [{
        account: EVENTS360_ACCOUNT_ID,
        amount: PROCESSING_FEE * 100, // paise
        currency: "INR",
        notes: {
          reference: referenceNumber,
          purpose: "processing_fee",
        },
        on_hold: 0,
      }]
    }

    let order: CreatedOrder
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Razorpay SDK TS types don't declare `transfers` on orders.create payload; runtime HTTP API accepts it (Razorpay Route).
      order = (await razorpay.orders.create(orderPayload as any)) as unknown as CreatedOrder
    } catch (orderErr) {
      // If transfer fails, retry without transfer — don't block payment
      const err = orderErr as { error?: { description?: string }; message?: string }
      const errMsg = err?.error?.description || err?.message || ""
      console.error("Order with transfer failed:", errMsg)

      if (PROCESSING_FEE > 0) {
        console.log("Retrying order without transfer...")
        delete orderPayload.transfers
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- same Razorpay SDK type gap as above; retry path without `transfers` still hits the same param-type mismatch.
        order = (await razorpay.orders.create(orderPayload as any)) as unknown as CreatedOrder
      } else {
        throw orderErr
      }
    }

    return Response.json({
      status: true,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      transferIncluded: !!orderPayload.transfers,
    })
  } catch (error) {
    console.error("Razorpay order error:", error)
    Sentry.captureException(error, {
      level: "error",
      tags: { route: "payments/create-order", op: "create_order_unhandled" },
    })
    return Response.json({ status: false, message: "Payment could not be initiated. Please try again." }, { status: 500 })
  }
}
