// @auth: public — applicant calls this after OTP verify, before payment, to
// create the membership_applications row at status='pending_payment'. The
// OTP-verified email (checked against otp_codes within a 2h window, same gate
// as submit/route.ts) is the integrity check. Gated behind
// WSC_EARLY_APPLICATION_ENABLED — flag OFF returns 404 (route pretends not
// to exist).
//
// Two-tab race: two simultaneous POSTs can both pass the idempotency check
// and reach the insert. WS-C commit 4 MUST add a partial unique index on
// membership_applications(email, membership_type) WHERE status='pending_payment'
// to make this safe. Until then: flag is OFF in production and no client
// caller exists (no caller is wired until WS-C commit 3).
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { featureFlags } from "@/lib/feature-flags"
import { getMembershipType } from "@/lib/membership-types"

const REFERENCE_NUMBER_RE = /^AMASI-\d{4}-[A-F0-9]{10}$/

export async function POST(request: NextRequest) {
  if (!featureFlags.wscEarlyApplication()) {
    Sentry.captureMessage("create-pending called with flag OFF", {
      level: "info",
      fingerprint: ["wsc-create-pending-flag-off"],
      tags: { route: "applications/create-pending", reason: "flag_off" },
    })
    return Response.json({ status: false, message: "Not found" }, { status: 404 })
  }

  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`create-pending:${ip}`, 10, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const { email, membershipType, referenceNumber, name } = await request.json()

    if (!email || !membershipType || !referenceNumber) {
      return Response.json(
        { status: false, message: "email, membershipType, and referenceNumber are required" },
        { status: 400 },
      )
    }

    if (typeof referenceNumber !== "string" || !REFERENCE_NUMBER_RE.test(referenceNumber)) {
      return Response.json(
        { status: false, message: "Invalid reference number format" },
        { status: 400 },
      )
    }

    const typeKey = String(membershipType).toUpperCase()
    if (!getMembershipType(typeKey)) {
      return Response.json({ status: false, message: "Invalid membership type" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const emailKey = String(email).toLowerCase().trim()

    // OTP gate — mirrors submit/route.ts:142-176 (2h window on otp_codes).
    const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000).toISOString()
    const { data: otpRow } = await supabase
      .from("otp_codes")
      .select("id")
      .eq("email", emailKey)
      .eq("verified", true)
      .gte("created_at", twoHoursAgo)
      .limit(1)
      .maybeSingle()

    if (!otpRow) {
      return Response.json({ status: false, message: "Email not verified" }, { status: 401 })
    }

    // Idempotency on (email, membership_type). Returns the existing
    // pending_payment row if present; 409s if a non-pending_payment row
    // already exists (caller should not be creating a new app).
    const { data: existing } = await supabase
      .from("membership_applications")
      .select("id, reference_number, status")
      .eq("email", emailKey)
      .eq("membership_type", typeKey)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing) {
      if (existing.status === "pending_payment") {
        return Response.json({
          status: true,
          applicationId: existing.id,
          referenceNumber: existing.reference_number,
          idempotent: true,
        })
      }
      return Response.json(
        {
          status: false,
          code: "ALREADY_EXISTS",
          referenceNumber: existing.reference_number,
          message: `An application already exists for this email and membership type (${existing.reference_number}).`,
        },
        { status: 409 },
      )
    }

    const fallbackName =
      (typeof name === "string" && name.trim()) || emailKey.split("@")[0] || "Applicant"

    const { data: inserted, error: insertError } = await supabase
      .from("membership_applications")
      .insert({
        reference_number: referenceNumber,
        email: emailKey,
        name: fallbackName,
        membership_type: typeKey,
        status: "pending_payment",
        email_verified: true,
        payment_status: "pending",
      })
      .select("id")
      .single()

    if (insertError || !inserted) {
      Sentry.captureException(insertError ?? new Error("create-pending insert returned no row"), {
        level: "fatal",
        tags: { route: "applications/create-pending", op: "insert_failure" },
        extra: { emailKey, typeKey, referenceNumber },
      })
      return Response.json(
        { status: false, message: "Failed to create application" },
        { status: 500 },
      )
    }

    return Response.json(
      {
        status: true,
        applicationId: inserted.id,
        referenceNumber,
        idempotent: false,
      },
      { status: 201 },
    )
  } catch (error) {
    Sentry.captureException(error, {
      level: "error",
      tags: { route: "applications/create-pending", op: "unhandled" },
    })
    return Response.json(
      { status: false, message: "Could not create application" },
      { status: 500 },
    )
  }
}
