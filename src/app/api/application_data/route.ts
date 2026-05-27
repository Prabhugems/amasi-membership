// @auth: public — legacy mobile shim. Receipt-screen render after payment
// success. Looks up the paid draft by reference_number (stored in
// step_data.reference_number by /final_step) and returns the legacy
// "Application Data" envelope with hardcoded webaddress/webphone/webemail/
// webgst per backend-spec.md §32.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { APPLICATION_TYPES } from "@/app/api/get_application/route"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

// Hardcoded org contact details — the legacy backend baked these into the
// `application_data` handler (controller.js:10226-10230) rather than
// reading from tbl_settings. Replicated verbatim because the Flutter
// receipt screen renders them as the invoice header.
const WEB_ADDRESS = "45 A Pankaja Mill Road, Ramanathapuram, Coimbatore, Tamil Nadu 641045, IN"
const WEB_PHONE = "+914224223330"
const WEB_EMAIL = "amasi.india@gmail.com"
const WEB_GST = "33AAAA6705D1ZF"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const applicationNo = field(form, "application_no").trim()
    if (!applicationNo) return legacyErr("No data found")

    const supabase = createAdminClient()

    // Most callers will hit this with the reference_number we returned from
    // /final_step. Look up by step_data->>reference_number, with payment_id
    // as a backup if the reference somehow drifted.
    const { data: draft } = await supabase
      .from("draft_applications")
      .select(
        "id, email, phone, membership_type, payment_id, payment_order_id, step_data, has_verified_payment"
      )
      .or(
        `step_data->>reference_number.eq.${applicationNo},payment_id.eq.${applicationNo},payment_order_id.eq.${applicationNo}`
      )
      .limit(1)
      .maybeSingle()

    if (!draft) {
      return legacyErr("No data found")
    }

    const stepData = (draft.step_data || {}) as Record<string, unknown>
    const formDataInDraft = (stepData.formData || {}) as Record<string, string>
    const personal = (stepData.personal || {}) as Record<string, string>
    const address = (stepData.address || {}) as Record<string, string>

    const typeKey = (draft.membership_type as string)?.toUpperCase()
    const appType = APPLICATION_TYPES.find((t) => t.typeKey === typeKey)

    // Look up the latest payment row to populate the receipt block.
    const { data: paymentRow } = await supabase
      .from("membership_payments")
      .select("amount, currency, gateway_payment_id, gateway_order_id, status, created_at")
      .or(
        `gateway_payment_id.eq.${draft.payment_id ?? ""},gateway_order_id.eq.${draft.payment_order_id ?? ""}`
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    // Legacy envelope shape per backend-spec.md §32.
    const data = [
      {
        id: draft.id,
        application_no: applicationNo,
        application_id: formDataInDraft.application_id ?? null,
        salutation: personal.salutation ?? formDataInDraft.salutation ?? "",
        first_name: personal.first_name ?? formDataInDraft.first_name ?? "",
        middle_name: personal.middle_name ?? formDataInDraft.middle_name ?? "",
        last_name: personal.last_name ?? formDataInDraft.last_name ?? "",
        email: draft.email,
        mobile_code: formDataInDraft.mobile_code ?? "",
        mobile: draft.phone ?? formDataInDraft.mobile ?? "",
        country: address.country ?? "",
        state: address.state ?? "",
        city: address.city ?? "",
        pin: address.pin ?? "",
        street_line1: address.street_line1 ?? "",
        street_line2: address.street_line2 ?? "",
      },
    ]

    const payment_status = paymentRow
      ? [
          {
            payment_status_name: paymentRow.status === "paid" ? "Success" : paymentRow.status,
            payment_id: paymentRow.gateway_payment_id,
            amount: paymentRow.amount,
            currency: paymentRow.currency,
            payed_date: paymentRow.created_at,
          },
        ]
      : []

    const application_data = appType
      ? [
          {
            id: appType.id,
            application_name: appType.application_name,
            fee: appType.fee,
            gst_value: appType.gst_value,
            processing_fee: appType.processing_fee,
            currency_code: appType.currency_code,
            gstAmount: (appType.fee * appType.gst_value) / 100,
            processingAmount: (appType.fee * appType.processing_fee) / 100,
            totalPrice:
              appType.fee +
              (appType.fee * appType.gst_value) / 100 +
              (appType.fee * appType.processing_fee) / 100,
          },
        ]
      : []

    return legacyOk("Application Data", {
      data,
      payment_status,
      application_data,
      webaddress: WEB_ADDRESS,
      webphone: WEB_PHONE,
      webemail: WEB_EMAIL,
      webgst: WEB_GST,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/application_data" } })
    return legacyErr("Something went wrong")
  }
}
