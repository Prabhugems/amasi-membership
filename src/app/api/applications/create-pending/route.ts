// @auth: public — applicant calls this after OTP verify, before payment, to
// create the membership_applications row at status='pending_payment'. The
// OTP-verified email (checked against otp_codes within a 2h window, same gate
// as submit/route.ts) is the integrity check. Gated behind
// WSC_EARLY_APPLICATION_ENABLED — flag OFF returns 404 (route pretends not
// to exist).
//
// Two-tab race: two simultaneous POSTs can both pass the idempotency SELECT
// and reach the insert. This is made safe by the existing partial unique index
// idx_unique_active_application on membership_applications(email,
// membership_type) WHERE status NOT IN ('rejected','withdrawn') — which covers
// pending_payment. The loser's insert hits 23505; we catch it below and return
// the winning row so both tabs converge (no 500, no duplicate).
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { featureFlags } from "@/lib/feature-flags"
import { getMembershipType } from "@/lib/membership-types"

const REFERENCE_NUMBER_RE = /^AMASI-\d{4}-[A-F0-9]{10}$/

export async function POST(request: NextRequest) {
  if (!featureFlags.wscEarlyApplication()) {
    // Flag is OFF in production until WS-C is validated end-to-end on Preview
    // (the index prerequisite is already satisfied — see the partial unique
    // index note above). Until then this route is supposed to be invisible:
    // 404 with no Sentry log. The client at
    // apply/page.tsx:1314 already treats 404 as a silent no-op (it's
    // the documented expected shape while the flag is off), so logging
    // each call generated noise without signal once WS-C commit 3
    // wired the client to call this on every pay step. Sentry issue
    // AMASI-MEMBERSHIP-1X tracked the noise; stripped 2026-05-25.
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
      // Two-tab race: a concurrent create-pending won and the partial unique
      // index idx_unique_active_application rejected this insert. Re-read and
      // return the existing pending_payment row so both tabs converge on the
      // same application instead of one getting a 500.
      if (insertError?.code === "23505") {
        const { data: raceRow } = await supabase
          .from("membership_applications")
          .select("id, reference_number, status")
          .eq("email", emailKey)
          .eq("membership_type", typeKey)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        if (raceRow?.status === "pending_payment") {
          return Response.json({
            status: true,
            applicationId: raceRow.id,
            referenceNumber: raceRow.reference_number,
            idempotent: true,
          })
        }
      }
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
