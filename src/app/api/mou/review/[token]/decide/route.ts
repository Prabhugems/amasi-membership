// @auth: public but token-gated — the Hon. Secretary's one decision.
import { NextRequest } from "next/server"
import { verifyApprovalToken, markTokenUsed } from "@/lib/mou/approval-token"
import { getApplicationById, updateApplicationStatus } from "@/lib/mou/supabase-helpers"
import { generateMouPdf } from "@/lib/mou/mou-pdf"
import { sendOutcomeEmail, sendWhatsAppNudge } from "@/lib/mou/notify"
import { getEventTypeConfig } from "@/lib/mou/event-type-config"
import { createAdminClient } from "@/lib/supabase"
import type { ApplicationTypeId } from "@/lib/mou/types"

const VALID_ACTIONS = ["approved", "rejected", "changes_requested"] as const
// notes becomes rejection_reason, which sendOutcomeEmail (src/lib/mou/notify.ts)
// interpolates into an outbound HTML email — cap it so one decider can't
// send an absurdly long email body, independent of the HTML-escaping done
// on the notify.ts side.
const MAX_NOTES_LENGTH = 500

// public.events.event_type is a Postgres enum (conference | course | workshop
// | webinar | symposium) with NOT NULL + a 'conference' default — confirmed
// against the live shared DB (project jmdwxymbgxwdsmcwbahp). Map our
// application types onto it so the amasi-faculty-management dashboard shows
// a plausible category instead of every auto-created event defaulting to
// "conference".
const EVENT_TYPE_BY_APPLICATION_TYPE: Record<ApplicationTypeId, "conference" | "course" | "workshop" | "webinar" | "symposium"> = {
  fmas: "course",
  mmas: "course",
  dmas: "course",
  workshop: "workshop",
  rural_program: "workshop",
  slcp: "workshop",
  nextgen: "workshop",
  meet_the_master: "workshop",
  zonal_event: "conference",
}

// public.events.slug is NOT NULL + UNIQUE with no default — an insert
// without one fails outright. Derive one from the event name and make it
// unique by suffixing a fragment of the (already-unique) application id,
// so two similarly-named approvals never collide.
function buildEventSlug(name: string, applicationId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  const suffix = applicationId.replace(/-/g, "").slice(0, 8)
  return `${base || "event"}-${suffix}`
}

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
  let createdEventId: string | undefined
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

    // Auto-create the real event in the shared `events` table — the same
    // Supabase database amasi-faculty-management's own dashboard reads
    // from — so an approved MOU becomes a schedulable event without manual
    // re-entry. This is a best-effort side effect: same principle as "a
    // failed WordPress push must not silently lose the approval" — a bad
    // insert here must never fail or roll back the decision that was
    // already persisted-in-intent above. Log/capture and move on.
    try {
      const eventName = application.event_name || `${typeLabel} — ${application.organizer_name}`
      const { data: eventRow, error: eventError } = await supabase
        .from("events")
        .insert({
          name: eventName,
          short_name: typeLabel,
          slug: buildEventSlug(eventName, application.id),
          event_type: EVENT_TYPE_BY_APPLICATION_TYPE[application.application_type_id] ?? "conference",
          description: `${typeLabel} hosted by ${application.organizer_name} at ${application.primary_institution}`,
          start_date: application.finalized_date || application.preferred_date_1,
          end_date: application.finalized_date || application.preferred_date_1,
          venue_name: application.venue_name,
          city: application.venue_city,
          state: application.venue_state,
          country: application.venue_country || "India",
          timezone: "Asia/Kolkata",
        })
        .select("id")
        .single()

      if (eventError || !eventRow) {
        throw new Error(eventError?.message || "event insert returned no row")
      }
      createdEventId = eventRow.id
    } catch (err) {
      console.error(`[mou-decide] event auto-create failed for application ${application.id}:`, err)
      const Sentry = await import("@sentry/nextjs")
      Sentry.captureException(err, {
        tags: { component: "mou-decide", op: "auto-create-event" },
        extra: { applicationId: application.id },
      })
    }
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
      ...(createdEventId ? { created_event_id: createdEventId } : {}),
    })
  } catch {
    return Response.json({ status: false, message: "Failed to save the decision. Please try again." }, { status: 500 })
  }

  await markTokenUsed(token, action)
  await sendOutcomeEmail(application, typeLabel, action, mouBuffer)
  await sendWhatsAppNudge(application, action)

  return Response.json({ status: true })
}
