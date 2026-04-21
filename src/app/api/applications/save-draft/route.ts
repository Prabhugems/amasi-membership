import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

async function verifyOtpSession(supabase: ReturnType<typeof createAdminClient>, email: string) {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data } = await supabase
    .from("otp_codes")
    .select("id")
    .eq("email", email.toLowerCase())
    .eq("verified", true)
    .gte("created_at", twoHoursAgo)
    .limit(1)
    .maybeSingle()
  return !!data
}

export async function PUT(request: NextRequest) {
  try {
    // Rate limit: 30 requests per 15 minutes per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`save-draft:${ip}`, 30, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const body = await request.json()
    const { email, current_step, step_data, payment_order_id, payment_id, lastUpdatedAt } = body

    // Validate required fields
    if (!email || typeof email !== "string") {
      return Response.json({ status: false, message: "Email is required" }, { status: 400 })
    }

    if (!current_step || typeof current_step !== "number" || current_step < 1 || current_step > 6) {
      return Response.json({ status: false, message: "current_step must be between 1 and 6" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify OTP session
    const otpValid = await verifyOtpSession(supabase, email)
    if (!otpValid) {
      return Response.json({ status: false, message: "Email not verified or session expired" }, { status: 401 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if draft exists
    const { data: existing } = await supabase
      .from("draft_applications")
      .select("id, step_data, updated_at")
      .eq("email", normalizedEmail)
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Merge step_data with existing data
      const mergedStepData = { ...(existing.step_data || {}), ...(step_data || {}) }

      const updatePayload: Record<string, unknown> = {
        current_step,
        step_data: mergedStepData,
        updated_at: new Date().toISOString(),
      }
      if (payment_order_id !== undefined) updatePayload.payment_order_id = payment_order_id
      if (payment_id !== undefined) updatePayload.payment_id = payment_id

      let query = supabase
        .from("draft_applications")
        .update(updatePayload)
        .eq("id", existing.id)

      // Optimistic locking: only update if updated_at matches
      if (lastUpdatedAt) {
        query = query.eq("updated_at", lastUpdatedAt)
      }

      const { data: updated, error: updateError } = await query
        .select("id, email, current_step, step_data, payment_order_id, payment_id, status, updated_at")
        .maybeSingle()

      if (updateError) {
        console.error("Draft update error:", updateError)
        return Response.json({ status: false, message: "Failed to save draft" }, { status: 500 })
      }

      // If no row returned and we used optimistic locking, it's a conflict
      if (!updated && lastUpdatedAt) {
        return Response.json(
          { status: false, message: "Draft was modified by another session. Please reload and try again." },
          { status: 409 }
        )
      }

      return Response.json({ status: true, draft: updated })
    }

    // Insert new draft
    const insertPayload: Record<string, unknown> = {
      email: normalizedEmail,
      current_step,
      step_data: step_data || {},
      status: "in_progress",
    }
    if (payment_order_id !== undefined) insertPayload.payment_order_id = payment_order_id
    if (payment_id !== undefined) insertPayload.payment_id = payment_id

    const { data: inserted, error: insertError } = await supabase
      .from("draft_applications")
      .insert(insertPayload)
      .select("id, email, current_step, step_data, payment_order_id, payment_id, status, updated_at")
      .single()

    if (insertError) {
      console.error("Draft insert error:", insertError)
      return Response.json({ status: false, message: "Failed to save draft" }, { status: 500 })
    }

    return Response.json({ status: true, draft: inserted })
  } catch (error: unknown) {
    console.error("Save draft error:", error)
    return Response.json({ status: false, message: "Failed to save draft" }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email")

    if (!email || typeof email !== "string") {
      return Response.json({ status: false, message: "Email is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify OTP session
    const otpValid = await verifyOtpSession(supabase, email)
    if (!otpValid) {
      return Response.json({ status: false, message: "Email not verified or session expired" }, { status: 401 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    const { data: draft, error } = await supabase
      .from("draft_applications")
      .select("id, email, current_step, step_data, payment_order_id, payment_id, status, updated_at")
      .eq("email", normalizedEmail)
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error("Draft lookup error:", error)
      return Response.json({ status: false, message: "Failed to retrieve draft" }, { status: 500 })
    }

    return Response.json({ status: true, data: draft || null })
  } catch (error: unknown) {
    console.error("Get draft error:", error)
    return Response.json({ status: false, message: "Failed to retrieve draft" }, { status: 500 })
  }
}
