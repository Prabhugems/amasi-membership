// @auth: public — legacy mobile shim. The Flutter "Track Application"
// screen (lib/view/application/application_track.dart:132) posts
// `email` + `application_no` and expects the legacy envelope with
// `data[0].{id, application_id, membership_no, application_status, status_name}`
// plus `payment_status[]`.
//
// In the new schema the legacy `application_no` is `reference_number`
// on `membership_applications` (e.g. "AMASI-2026-A0B79A0985"). The
// integer `application_number` is admin-only and seldom set. Match on
// reference_number first, then fall back to application_number for
// legacy callers who happen to send the integer.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 16.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

// Map new-schema status text → legacy integer sentinel + display label.
// Legacy used `application_status` as an int and `status_name` as the
// display string. Approximate mapping below; unknown statuses default to
// 1 ("Pending") rather than crashing the client.
function mapStatus(status: string | null | undefined): { code: number; label: string } {
  switch ((status ?? "").toLowerCase()) {
    case "approved":
      return { code: 12, label: "Approved" }
    case "rejected":
      return { code: 3, label: "Rejected" }
    case "needs_clarification":
    case "clarification":
      return { code: 4, label: "Clarification Required" }
    case "pending_review":
    case "submitted":
      return { code: 1, label: "Pending Review" }
    case "draft":
    case "incomplete":
      return { code: 0, label: "Draft" }
    case "pending_payment":
      return { code: 2, label: "Payment Pending" }
    default:
      return { code: 1, label: status ? String(status) : "Pending" }
  }
}

// Map payment_status text → legacy payment_status int (1=Success, 2=Failed,
// 3=Pending) used in tbl_payment_status joins.
function mapPayment(payment: string | null | undefined): { code: number; label: string } {
  switch ((payment ?? "").toLowerCase()) {
    case "paid":
    case "captured":
    case "success":
      return { code: 1, label: "Success" }
    case "failed":
      return { code: 2, label: "Failed" }
    case "pending":
    case "pending_payment":
      return { code: 3, label: "Pending" }
    default:
      return { code: 3, label: payment ? String(payment) : "Pending" }
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const email = field(form, "email").toLowerCase().trim()
    const appNo = field(form, "application_no").trim()

    if (!email || !appNo) {
      return legacyErr("Email and application number are required")
    }

    const supabase = createAdminClient()

    // Try reference_number first (the AMASI-YYYY-XXX shape the binary shows),
    // then the integer application_number for callers that supply that.
    let query = supabase
      .from("membership_applications")
      .select(
        "id, reference_number, application_number, status, payment_status, payment_id, payment_amount, assigned_amasi_number, member_id, created_at, reviewed_at"
      )
      .ilike("email", email)
      .limit(1)

    if (appNo.toUpperCase().startsWith("AMASI-")) {
      query = query.eq("reference_number", appNo)
    } else if (/^\d+$/.test(appNo)) {
      query = query.eq("application_number", parseInt(appNo, 10))
    } else {
      // Free-form — try reference_number first as the more common shape.
      query = query.eq("reference_number", appNo)
    }

    const { data: app, error: appErr } = await query.maybeSingle()

    if (appErr) {
      Sentry.captureException(appErr, {
        tags: { route: "shim/track_application", phase: "lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (!app) {
      return legacyErr("No application found for this email + application number")
    }

    const st = mapStatus(app.status)
    const pay = mapPayment(app.payment_status)

    const row = {
      id: app.id,
      application_id: app.reference_number ?? null,
      application_no: app.reference_number ?? null,
      membership_no: app.assigned_amasi_number ?? null,
      application_status: st.code,
      status_name: st.label,
    }

    // payment_status is an array in the legacy contract (one row per
    // payment attempt in tbl_member_payment). New schema collapses to a
    // single payment per application; emit one row when we have a
    // payment_id, else empty array.
    const payments = app.payment_id
      ? [
          {
            id: app.payment_id,
            payment_status: pay.code,
            payment_status_name: pay.label,
            payment_id: app.payment_id,
            amount: app.payment_amount ?? null,
            created_on: app.reviewed_at ?? app.created_at,
          },
        ]
      : []

    return legacyOk("OK", {
      data: [row],
      payment_status: payments,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/track_application" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST
