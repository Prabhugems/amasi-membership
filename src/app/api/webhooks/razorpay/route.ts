import { NextRequest } from "next/server"
import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase"
import { autoApproveApplication } from "@/lib/auto-approval"

/** Parse `"82% — high"` → 82. Returns null on mismatch. */
function parseAiScore(confidence: string | null | undefined): number | null {
  if (!confidence) return null
  const match = /^(\d+)%/.exec(confidence)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get("x-razorpay-signature")

    if (!signature) {
      return Response.json({ error: "Missing signature" }, { status: 400 })
    }

    // Verify webhook signature
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim()
    if (!webhookSecret) {
      console.error("No Razorpay webhook secret configured")
      return Response.json({ error: "Server config error" }, { status: 500 })
    }

    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret.trim())
      .update(rawBody)
      .digest("hex")

    if (expectedSignature !== signature) {
      console.error("Razorpay webhook signature mismatch")
      return Response.json({ error: "Invalid signature" }, { status: 400 })
    }

    const event = JSON.parse(rawBody)
    const supabase = createAdminClient()

    if (event.event === "payment.captured") {
      const payment = event.payload?.payment?.entity
      if (!payment) return Response.json({ status: "ok" })

      const orderId = payment.order_id
      const paymentId = payment.id
      const amount = payment.amount / 100 // paise to rupees
      const referenceNumber = payment.notes?.reference_number

      // Check if payment already recorded (idempotency)
      const { data: existing } = await supabase
        .from("membership_payments")
        .select("id")
        .eq("gateway_payment_id", paymentId)
        .limit(1)

      if (existing && existing.length > 0) {
        return Response.json({ status: "already_processed" })
      }

      // Look up the real member email from the application (if we have a ref number)
      let memberEmail: string | null = null
      if (referenceNumber) {
        const { data: appRow } = await supabase
          .from("membership_applications")
          .select("email")
          .eq("reference_number", referenceNumber)
          .maybeSingle()
        memberEmail = appRow?.email ?? null
      }

      // Record payment
      await supabase.from("membership_payments").insert({
        member_email: memberEmail,
        gateway_order_id: orderId,
        gateway_payment_id: paymentId,
        payment_gateway: "razorpay",
        status: "paid",
        amount,
        currency: payment.currency || "INR",
        source: "webhook",
      })

      // Update application if reference number present
      if (referenceNumber) {
        await supabase
          .from("membership_applications")
          .update({
            payment_status: "paid",
            payment_id: paymentId,
            updated_at: new Date().toISOString(),
          })
          .eq("reference_number", referenceNumber)
          .eq("payment_status", "pending")
      }

      console.log(`Webhook: payment.captured — ${paymentId} for ${referenceNumber}`)

      // --- Recovery branch: auto-approve if the app is still in `submitted`
      // status with a qualifying AI score. Catches rows that somehow landed
      // in `submitted` despite qualifying for auto-approval (admin recovery,
      // legacy rows, future flow changes).
      //
      // Safety: if anything below throws/fails, we swallow it — the webhook's
      // primary contract ("payment recorded") has already succeeded above.
      if (referenceNumber) {
        try {
          const { data: appRow, error: appErr } = await supabase
            .from("membership_applications")
            .select(
              [
                "id",
                "status",
                "ai_confidence",
                "ai_verified",
                "salutation",
                "first_name",
                "middle_name",
                "last_name",
                "father_name",
                "date_of_birth",
                "gender",
                "nationality",
                "email",
                "phone",
                "mobile_code",
                "membership_type",
                "street_address_1",
                "street_address_2",
                "city",
                "state",
                "country",
                "postal_code",
                "zone",
                "ug_degree",
                "ug_college",
                "ug_university",
                "ug_year",
                "pg_degree",
                "pg_college",
                "pg_university",
                "pg_year",
                "ss_degree",
                "mci_council_number",
                "mci_council_state",
                "imr_registration_no",
                "asi_membership_no",
                "asi_state",
              ].join(", "),
            )
            .eq("reference_number", referenceNumber)
            .maybeSingle()

          if (appErr) {
            console.error("[webhook] recovery: failed to load application:", appErr)
          } else if (appRow) {
            const row = appRow as unknown as Record<string, unknown>
            const score = parseAiScore(row.ai_confidence as string | null)

            if (row.status === "submitted" && score !== null && score >= 80) {
              console.log(
                `[webhook] recovery: application ${referenceNumber} qualifies for auto-approval (score=${score}) — running`,
              )

              const result = await autoApproveApplication(supabase, {
                applicationId: row.id as string,
                referenceNumber,
                salutation: (row.salutation as string | null) ?? null,
                firstName: (row.first_name as string | null) ?? null,
                middleName: (row.middle_name as string | null) ?? null,
                lastName: (row.last_name as string | null) ?? null,
                fatherName: (row.father_name as string | null) ?? null,
                dateOfBirth: (row.date_of_birth as string | null) ?? null,
                gender: (row.gender as string | null) ?? null,
                nationality: (row.nationality as string | null) ?? null,
                email: row.email as string,
                phone: (row.phone as string | null) ?? null,
                mobileCode: (row.mobile_code as string | null) ?? null,
                membershipType: row.membership_type as string,
                streetAddress1: (row.street_address_1 as string | null) ?? null,
                streetAddress2: (row.street_address_2 as string | null) ?? null,
                city: (row.city as string | null) ?? null,
                state: (row.state as string | null) ?? null,
                country: (row.country as string | null) ?? null,
                postalCode: (row.postal_code as string | null) ?? null,
                zone: (row.zone as string | null) ?? null,
                ugDegree: (row.ug_degree as string | null) ?? null,
                ugCollege: (row.ug_college as string | null) ?? null,
                ugUniversity: (row.ug_university as string | null) ?? null,
                ugYear: (row.ug_year as string | number | null) ?? null,
                pgDegree: (row.pg_degree as string | null) ?? null,
                pgCollege: (row.pg_college as string | null) ?? null,
                pgUniversity: (row.pg_university as string | null) ?? null,
                pgYear: (row.pg_year as string | number | null) ?? null,
                ssDegree: (row.ss_degree as string | null) ?? null,
                mciCouncilNumber: (row.mci_council_number as string | null) ?? null,
                mciCouncilState: (row.mci_council_state as string | null) ?? null,
                imrRegistrationNo: (row.imr_registration_no as string | null) ?? null,
                asiMembershipNo: (row.asi_membership_no as string | null) ?? null,
                asiState: (row.asi_state as string | null) ?? null,
                reviewNotes: `Auto-approved via webhook recovery — AI score ${score}% on payment capture.`,
              })

              if (result.success) {
                console.log(
                  `[webhook] recovery: auto-approved ${referenceNumber} → AMASI #${result.amasiNumber}`,
                )
              } else {
                // Helper has already logged. We intentionally do NOT mutate
                // the application or notify on failure here — the main
                // webhook contract (payment recorded) remains satisfied.
                console.warn(
                  `[webhook] recovery: auto-approval declined at stage=${result.stage} for ${referenceNumber}: ${result.reason}`,
                )
              }
            }
          }
        } catch (recoveryErr) {
          // Never let recovery turn a successful webhook into a failed one.
          console.error("[webhook] recovery: unexpected error (swallowed):", recoveryErr)
        }
      }
    }

    if (event.event === "payment.failed") {
      const payment = event.payload?.payment?.entity
      if (!payment) return Response.json({ status: "ok" })

      const referenceNumber = payment.notes?.reference_number
      if (referenceNumber) {
        await supabase
          .from("membership_applications")
          .update({
            payment_status: "failed",
            updated_at: new Date().toISOString(),
          })
          .eq("reference_number", referenceNumber)
          .eq("payment_status", "pending")
      }

      console.log(`Webhook: payment.failed — ${payment.id} for ${referenceNumber}`)
    }

    return Response.json({ status: "ok" })
  } catch (error: any) {
    console.error("Razorpay webhook error:", error)
    return Response.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
