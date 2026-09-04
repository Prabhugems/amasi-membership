// @auth: public but token-gated — the Hon. Secretary's one decision.
import { NextRequest } from "next/server"
import { verifyApprovalToken, markTokenUsed } from "@/lib/mou/approval-token"
import { getApplicationById, updateApplicationStatus } from "@/lib/mou/supabase-helpers"
import { generateMouPdf } from "@/lib/mou/mou-pdf"
import { sendOutcomeEmail, sendWhatsAppNudge } from "@/lib/mou/notify"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { createAdminClient } from "@/lib/supabase"

const VALID_ACTIONS = ["approved", "rejected", "changes_requested"] as const
// notes becomes rejection_reason, which sendOutcomeEmail (src/lib/mou/notify.ts)
// interpolates into an outbound HTML email — cap it so one decider can't
// send an absurdly long email body, independent of the HTML-escaping done
// on the notify.ts side.
const MAX_NOTES_LENGTH = 500

export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const { action, notes } = await request.json()
  if (!VALID_ACTIONS.includes(action)) {
    return Response.json({ status: false, message: "Invalid action" }, { status: 400 })
  }
  let safeNotes: string | null = null
  if (notes !== undefined && notes !== null) {
    if (typeof notes !== "string") {
      return Response.json({ status: false, message: "Invalid notes" }, { status: 400 })
    }
    safeNotes = notes.trim().slice(0, MAX_NOTES_LENGTH)
  }

  // Re-verify the token fresh, right here, right before the state-changing
  // action — never trust a result from an earlier request/response in this
  // flow (e.g. the GET landing-page call). ok=false covers unknown/expired/
  // already-used tokens; can_decide=false covers valid-but-notify-only
  // tokens (President / zone chairs), which must never be able to decide
  // even though their token is otherwise perfectly valid.
  const verified = await verifyApprovalToken(token)
  if (!verified.ok) return Response.json({ status: false, message: verified.message }, { status: 400 })
  if (!verified.row.can_decide) {
    return Response.json({ status: false, message: "This link cannot make a decision" }, { status: 403 })
  }

  const application = await getApplicationById(verified.row.application_id)
  if (!application) return Response.json({ status: false, message: "Application not found" }, { status: 404 })

  const typeConfig = getEventTypeConfig(application.application_type_id)
  const typeLabel = typeConfig?.label ?? application.application_type_id

  let mouUrl: string | undefined
  let mouBuffer: Buffer | undefined
  if (action === "approved") {
    mouBuffer = await generateMouPdf(application, typeLabel)
    const supabase = createAdminClient()
    const fileName = `mou/${application.id}-v${application.mou_version + 1}.pdf`
    const { error: uploadError } = await supabase.storage
      .from("uploads")
      .upload(fileName, mouBuffer, { contentType: "application/pdf", upsert: true })
    // If the PDF didn't actually land in storage, stop here: don't persist
    // an "approved" status pointing at a URL that 404s, and don't burn the
    // token — the Hon. Secretary should be able to retry the decision.
    if (uploadError) {
      return Response.json({ status: false, message: "Failed to generate MOU document. Please try again." }, { status: 500 })
    }
    const { data: publicUrlData } = supabase.storage.from("uploads").getPublicUrl(fileName)
    mouUrl = publicUrlData.publicUrl
  }

  // markTokenUsed (and the outbound notifications) must only fire once the
  // decision is actually persisted. updateApplicationStatus resolves even
  // on a Supabase-level write error (it doesn't inspect/throw on {error}),
  // so a thrown exception here is the only signal available to this route —
  // treat it as "not persisted" and bail before touching the token, rather
  // than silently proceeding as if the decision went through.
  try {
    await updateApplicationStatus(application.id, action, {
      reviewed_by: verified.row.role,
      reviewed_at: new Date().toISOString(),
      rejection_reason: action !== "approved" ? safeNotes : null,
      ...(mouUrl ? { mou_generated_url: mouUrl, mou_version: application.mou_version + 1 } : {}),
    })
  } catch {
    return Response.json({ status: false, message: "Failed to save the decision. Please try again." }, { status: 500 })
  }

  await markTokenUsed(token, action)
  await sendOutcomeEmail(application, typeLabel, action, mouBuffer)
  await sendWhatsAppNudge(application, action)

  return Response.json({ status: true })
}
