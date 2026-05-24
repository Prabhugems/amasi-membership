import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getMemberSession } from "@/lib/auth"
import { recordStepEvent } from "@/lib/funnel-tracking"
import { checkDuplicateApplication } from "@/lib/application-utils"
import { mergeDraftUploads } from "@/lib/merge-draft-uploads"

/** Verify the caller has a valid member JWT cookie matching the given email. */
async function verifyMemberSession(email: string): Promise<boolean> {
  const session = await getMemberSession()
  if (!session) return false
  return (session.email as string)?.toLowerCase() === email.toLowerCase()
}

export async function PUT(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"

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

    // Rate limit per (ip, email). Per-IP-only previously bucketed every
    // hospital NAT user together — five colleagues filling apps from the
    // same WAN tripped each other's 429s during AMASICON. Tuple keying
    // gives each applicant their own budget while still throttling abuse
    // (session check above means only OTP-verified emails reach this).
    const rl = await checkRateLimit(`save-draft:${ip}:${normalizedEmail}`, 60, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
    }

    // Check if draft exists
    const { data: existing } = await supabase
      .from("draft_applications")
      .select("id, step_data, updated_at, membership_type, current_step, has_verified_payment")
      .eq("email", normalizedEmail)
      .limit(1)
      .maybeSingle()

    // Existing-member gate: if this email/phone already belongs to a real
    // member, block the new-application flow before any draft is saved.
    // Skip the check only when the draft already has a verified payment —
    // those rows must complete the post-payment flow even if the gate would
    // otherwise refuse them.
    if (!existing?.has_verified_payment) {
      const phoneFromBody = typeof step_data?.mobile === "string" ? step_data.mobile : (typeof body.mobile === "string" ? body.mobile : "")
      const dup = await checkDuplicateApplication(normalizedEmail, phoneFromBody)
      if (dup.existingMember) {
        return Response.json(
          {
            status: false,
            code: "EXISTING_MEMBER",
            message: dup.message,
            existingMember: dup.existingMember,
          },
          { status: 409 }
        )
      }
    }

    if (existing) {
      // Always use optimistic locking for existing drafts
      const lockValue = lastUpdatedAt || existing.updated_at

      // Merge step_data with existing data.
      //
      // Non-uploads keys (formData, membership_type, email_verified, etc.):
      // shallow override, same as pre-Stage-B. Behavior unchanged.
      //
      // `uploads`: per-key merge via mergeDraftUploads (Stage B, 2026-05-23).
      // The shallow-merge wholesale-replace pattern caused six paid
      // applicants to lose their fileUrls on 2026-05-23. mergeDraftUploads
      // refuses to clobber an existing fileUrl with a null/empty one and
      // treats `uploads = {}` as a no-op. Removal is now opt-in via a
      // null sentinel (apply/page.tsx handleRemoveFile patched in lockstep).
      const existingStepData = (existing.step_data || {}) as Record<string, unknown>
      const incomingStepData = (step_data || {}) as Record<string, unknown>
      const mergedStepData: Record<string, unknown> = {
        ...existingStepData,
        ...incomingStepData,
      }
      if ("uploads" in incomingStepData) {
        mergedStepData.uploads = mergeDraftUploads(
          existingStepData.uploads as Record<string, unknown> | null | undefined,
          incomingStepData.uploads as Record<string, unknown> | null | undefined,
        )
      }

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
        Sentry.captureException(updateError, {
          tags: { route: "applications/save-draft", op: "update", reason: "save_draft_write_failure" },
          extra: { draft_id: existing.id, current_step, has_payment_order_id: payment_order_id !== undefined, has_payment_id: payment_id !== undefined },
        })
        return Response.json({ status: false, message: "Failed to save draft" }, { status: 500 })
      }

      // If no row returned, it's a conflict (optimistic lock failed). Re-SELECT
      // to get the actual current updated_at — `existing.updated_at` is the
      // value we read BEFORE the failed update, which in a 2-writer race
      // equals the client's stale lastUpdatedAt. Echoing it back makes the
      // client retry with the same stale value and 409 forever. See Sentry
      // AMASI-MEMBERSHIP-D (37 users, step 3 parallel OCR save burst).
      if (!updated) {
        const { data: fresh } = await supabase
          .from("draft_applications")
          .select("updated_at")
          .eq("id", existing.id)
          .maybeSingle()
        return Response.json(
          {
            status: false,
            code: "CONFLICT",
            message: "Draft was modified by another session.",
            serverUpdatedAt: fresh?.updated_at ?? existing.updated_at,
          },
          { status: 409 }
        )
      }

      // Funnel: only log when the step actually advanced (save-draft is also
      // called for intra-step auto-saves, which would otherwise spam the table).
      if (current_step !== existing.current_step) {
        void recordStepEvent({
          email: normalizedEmail,
          draftId: updated.id,
          eventType: "step_entered",
          step: current_step,
          metadata: { from_step: existing.current_step, membership_type: membership_type ?? existing.membership_type },
        }, supabase)
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
      Sentry.captureException(insertError, {
        tags: { route: "applications/save-draft", op: "insert", reason: "save_draft_write_failure" },
        extra: { current_step, membership_type, has_payment_order_id: payment_order_id !== undefined, has_payment_id: payment_id !== undefined },
      })
      return Response.json({ status: false, message: "Failed to save draft" }, { status: 500 })
    }

    // Funnel: first persisted step for this email
    void recordStepEvent({
      email: normalizedEmail,
      draftId: inserted.id,
      eventType: "step_entered",
      step: current_step,
      metadata: { first_save: true, membership_type },
    }, supabase)

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
