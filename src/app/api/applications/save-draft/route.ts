import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getMemberSession } from "@/lib/auth"

/** Verify the caller has a valid member JWT cookie matching the given email. */
async function verifyMemberSession(email: string): Promise<boolean> {
  const session = await getMemberSession()
  if (!session) return false
  return (session.email as string)?.toLowerCase() === email.toLowerCase()
}

export async function PUT(request: NextRequest) {
  try {
    // Rate limit: 30 requests per 15 minutes per IP
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`save-draft:${ip}`, 60, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    const body = await request.json()
    const { email, current_step, step_data, payment_order_id, payment_id, lastUpdatedAt } = body
    const membership_type = step_data?.membership_type || body.membership_type || null

    // Validate required fields
    if (!email || typeof email !== "string") {
      return Response.json({ status: false, message: "Email is required" }, { status: 400 })
    }

    if (!current_step || typeof current_step !== "number" || current_step < 1 || current_step > 6) {
      return Response.json({ status: false, message: "current_step must be between 1 and 6" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Verify member JWT session matches this email
    const sessionValid = await verifyMemberSession(email)
    if (!sessionValid) {
      return Response.json({ status: false, message: "Email not verified or session expired" }, { status: 401 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if draft exists
    const { data: existing } = await supabase
      .from("draft_applications")
      .select("id, step_data, updated_at, membership_type")
      .eq("email", normalizedEmail)
      .limit(1)
      .maybeSingle()

    if (existing) {
      // Always use optimistic locking for existing drafts
      const lockValue = lastUpdatedAt || existing.updated_at

      // Merge step_data with existing data
      const mergedStepData = { ...(existing.step_data || {}), ...(step_data || {}) }

      const updatePayload: Record<string, unknown> = {
        current_step,
        step_data: mergedStepData,
        membership_type: membership_type ?? existing.membership_type,
        updated_at: new Date().toISOString(),
      }
      if (payment_order_id !== undefined) updatePayload.payment_order_id = payment_order_id
      if (payment_id !== undefined) {
        updatePayload.payment_id = payment_id
        updatePayload.has_verified_payment = true
      }

      const query = supabase
        .from("draft_applications")
        .update(updatePayload)
        .eq("id", existing.id)
        .eq("updated_at", lockValue)

      const { data: updated, error: updateError } = await query
        .select("id, email, current_step, step_data, payment_order_id, payment_id, status, updated_at")
        .maybeSingle()

      if (updateError) {
        console.error("Draft update error:", updateError)
        return Response.json({ status: false, message: "Failed to save draft" }, { status: 500 })
      }

      // If no row returned, it's a conflict (optimistic lock failed)
      if (!updated) {
        return Response.json(
          { status: false, code: "CONFLICT", message: "Draft was modified by another session.", serverUpdatedAt: existing.updated_at },
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
      membership_type,
      status: "in_progress",
    }
    if (payment_order_id !== undefined) insertPayload.payment_order_id = payment_order_id
    if (payment_id !== undefined) {
      insertPayload.payment_id = payment_id
      insertPayload.has_verified_payment = true
    }

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

    // Verify member JWT session matches this email
    const sessionValid = await verifyMemberSession(email)
    if (!sessionValid) {
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

export async function DELETE(request: NextRequest) {
  try {
    const email = request.nextUrl.searchParams.get("email")

    if (!email || typeof email !== "string") {
      return Response.json({ status: false, message: "Email is required" }, { status: 400 })
    }

    // Verify member JWT session matches this email
    const sessionValid = await verifyMemberSession(email)
    if (!sessionValid) {
      return Response.json({ status: false, message: "Email not verified or session expired" }, { status: 401 })
    }

    const supabase = createAdminClient()
    const normalizedEmail = email.toLowerCase().trim()

    // Check if draft has a verified payment — block deletion
    const { data: draft } = await supabase
      .from("draft_applications")
      .select("has_verified_payment")
      .eq("email", normalizedEmail)
      .maybeSingle()

    if (draft?.has_verified_payment) {
      return Response.json(
        { status: false, message: "Cannot delete application with pending payment. Please resume instead." },
        { status: 400 }
      )
    }

    // Delete draft and clean up storage
    const { deleteDraft } = await import("@/lib/draft-utils")
    await deleteDraft(normalizedEmail)

    return Response.json({ status: true, message: "Draft deleted" })
  } catch (error: unknown) {
    console.error("Delete draft error:", error)
    return Response.json({ status: false, message: "Failed to delete draft" }, { status: 500 })
  }
}
