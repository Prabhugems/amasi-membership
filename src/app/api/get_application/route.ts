// @auth: public — legacy mobile shim. Returns the membership-type catalog
// for the Flutter apply-landing screen. Pricing mirrors MEMBERSHIP_FEES in
// src/app/api/payments/create-order/route.ts (the server-side source of
// truth). ID-to-typeKey mapping is preserved for the shim's create_order +
// member_two/three handlers to translate Flutter's numeric application_id
// back to the typeKey (LM/ALM/ACM/ILM/...) amasi-membership uses internally.
//
// See migration/backend-spec.md §20.

import { legacyOk } from "@/lib/mobile-shim"

// Single source of truth for the legacy applicationId → typeKey mapping.
// Add to APPLICATION_TYPES if AMASI introduces a new tier; do not collapse
// rows 5/6 (conversion paths) into row 1 — the Flutter UI treats them as
// distinct entry points (ACM-to-LM is `application_convertion.dart`).
export const APPLICATION_TYPES = [
  {
    id: 1,
    typeKey: "LM",
    application_name: "Life Member",
    fee: 4230,
    gst_value: 0,
    processing_fee: 0,
    currency_code: "INR",
  },
  {
    id: 2,
    typeKey: "ALM",
    application_name: "Associate Life Member",
    fee: 4230,
    gst_value: 0,
    processing_fee: 0,
    currency_code: "INR",
  },
  {
    id: 3,
    typeKey: "ACM",
    application_name: "Associate Candidate Member",
    fee: 4230,
    gst_value: 0,
    processing_fee: 0,
    currency_code: "INR",
  },
  {
    id: 4,
    typeKey: "ILM",
    application_name: "International Life Member",
    fee: 300,
    gst_value: 0,
    processing_fee: 0,
    currency_code: "USD",
  },
  {
    id: 5,
    typeKey: "LM",
    application_name: "Conversion (ASI to LM)",
    fee: 4230,
    gst_value: 0,
    processing_fee: 0,
    currency_code: "INR",
  },
  {
    id: 6,
    typeKey: "LM",
    application_name: "Conversion (ALM to LM)",
    fee: 4230,
    gst_value: 0,
    processing_fee: 0,
    currency_code: "INR",
  },
] as const

export function findApplicationType(
  id: number | string
): (typeof APPLICATION_TYPES)[number] | null {
  const n = typeof id === "number" ? id : parseInt(String(id), 10)
  return APPLICATION_TYPES.find((t) => t.id === n) ?? null
}

export async function GET() {
  // Render the legacy shape: each row carries gstAmount / processingAmount /
  // totalPrice as pre-computed numbers so the Flutter tile UI doesn't have
  // to do arithmetic. With gst_value=0 and processing_fee=0, totalPrice
  // equals fee.
  const data = APPLICATION_TYPES.map((t) => {
    const gstAmount = (t.fee * t.gst_value) / 100
    const processingAmount = (t.fee * t.processing_fee) / 100
    const totalPrice = t.fee + gstAmount + processingAmount
    return {
      id: t.id,
      application_name: t.application_name,
      fee: t.fee,
      gst_value: t.gst_value,
      processing_fee: t.processing_fee,
      currency_code: t.currency_code,
      gstAmount,
      processingAmount,
      totalPrice,
      application_count: 0,
    }
  })
  return legacyOk("Application list.", { data })
}
