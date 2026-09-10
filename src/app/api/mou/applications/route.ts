// /api/mou/applications — member-facing event-hosting applications.
//
// Auth: active member session via resolveMouApplicant (getMemberSession +
// members.status = 'active'). Allowlisted in middleware PUBLIC_API_ROUTES
// under "/api/mou/" because callers hold the member cookie, not the admin
// cookie; every handler here does its own check.
//
// AuthZ rule: a member only ever reads rows where member_id = caller, and can
// only create rows for themselves — identity fields come from `members`, not
// from the body (see src/lib/mou-applications.ts header).
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getMemberSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { logMembershipAuditEvent } from "@/lib/audit-log"
import { resolveMouApplicant, applicantErrorResponse } from "@/lib/mou-member"
import { generateMouReference, validateMouSubmission, type MouAttachment } from "@/lib/mou-applications"
import { sendMouSubmittedEmails } from "@/lib/mou-emails"
import { MOU_OPEN_STATUSES, isMouEventType } from "@/lib/mou-events"
import { signStorageValues } from "@/lib/storage-url"

const MEMBER_SELECT =
  "id, reference_number, event_type, status, event_title, proposed_date, proposed_end_date, proposed_year, place, state, venue_name, venue_type, attachments, decision_reason, signed_mou_path, created_at, updated_at, reviewed_at"

export async function GET(request: NextRequest) {
  const supabase = createAdminClient()
  const who = await resolveMouApplicant(supabase, await getMemberSession())
  if (!who.ok) return applicantErrorResponse(who)

  const eventParam = request.nextUrl.searchParams.get("event")
  let q = supabase
    .from("mou_applications")
    .select(MEMBER_SELECT)
    .eq("member_id", who.applicant.member_id)
    .order("created_at", { ascending: false })
    .limit(50)
  if (eventParam && isMouEventType(eventParam)) q = q.eq("event_type", eventParam)

  const { data, error } = await q
  if (error) {
    Sentry.captureException(error, { tags: { route: "api/mou/applications", op: "list" } })
    return Response.json({ status: false, message: "Failed to load applications" }, { status: 500 })
  }

  // Sign the member's own attachment paths (and the signed MOU, if HQ has
  // uploaded one) at the read boundary.
  const rows = data ?? []
  const values: string[] = []
  for (const r of rows) {
    for (const a of (r.attachments as MouAttachment[]) ?? []) values.push(a.path)
    if (r.signed_mou_path) values.push(r.signed_mou_path)
  }
  const signed = values.length ? await signStorageValues(values) : new Map<string, string | null>()

  return Response.json({
    status: true,
    applications: rows.map((r) => ({
      ...r,
      attachments: ((r.attachments as MouAttachment[]) ?? []).map((a) => ({
        key: a.key,
        filename: a.filename,
        size: a.size,
        url: signed.get(a.path) ?? null,
      })),
      signed_mou_url: r.signed_mou_path ? signed.get(r.signed_mou_path) ?? null : null,
      signed_mou_path: undefined,
    })),
  })
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()
  const who = await resolveMouApplicant(supabase, await getMemberSession())
  if (!who.ok) return applicantErrorResponse(who)
  const applicant = who.applicant

  const rl = await checkRateLimit(`mou-submit:${applicant.member_id}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many submissions. Please try again later." },
      { status: 429 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request body" }, { status: 400 })
  }

  const validated = validateMouSubmission(body, applicant.member_id)
  if (!validated.ok) {
    return Response.json(
      { status: false, message: "Please correct the highlighted fields", errors: validated.errors },
      { status: 400 }
    )
  }
  const v = validated.value

  // One open application per member per event type. Not a race-proof
  // constraint, but it stops the double-click / retry duplicate.
  const { data: open } = await supabase
    .from("mou_applications")
    .select("id, reference_number")
    .eq("member_id", applicant.member_id)
    .eq("event_type", v.event_type)
    .in("status", [...MOU_OPEN_STATUSES])
    .limit(1)
    .maybeSingle()
  if (open) {
    return Response.json(
      {
        status: false,
        code: "ALREADY_OPEN",
        message: `You already have an open application for this event (${open.reference_number}). AMASI HQ will get back to you on it.`,
      },
      { status: 409 }
    )
  }

  const insertRow = {
    event_type: v.event_type,
    status: "submitted",
    member_id: applicant.member_id,
    amasi_number: applicant.amasi_number,
    applicant_name: applicant.applicant_name,
    applicant_email: applicant.applicant_email,
    applicant_phone: applicant.applicant_phone,
    applicant_address: applicant.applicant_address,
    member_since: applicant.member_since,
    event_title: v.event_title,
    proposed_date: v.proposed_date,
    proposed_end_date: v.proposed_end_date,
    proposed_year: v.proposed_year,
    place: v.place,
    state: v.state,
    venue_name: v.venue_name,
    venue_type: v.venue_type,
    joint_with_association: v.joint_with_association,
    partner_association: v.partner_association,
    supporting_city_chapter: v.supporting_city_chapter,
    supporting_state_chapter: v.supporting_state_chapter,
    supporting_others: v.supporting_others,
    remarks: v.remarks,
    details: v.details,
    declarations: v.declarations,
    attachments: v.attachments,
  }

  let created: { id: string; reference_number: string } | null = null
  for (let attempt = 0; attempt < 3 && !created; attempt++) {
    const { data, error } = await supabase
      .from("mou_applications")
      .insert({ ...insertRow, reference_number: generateMouReference() })
      .select("id, reference_number")
      .single()
    if (!error && data) {
      created = data
      break
    }
    if (error?.code === "23505") continue // reference collision — retry
    Sentry.captureException(error, { tags: { route: "api/mou/applications", op: "insert" } })
    return Response.json({ status: false, message: "Failed to submit application" }, { status: 500 })
  }
  if (!created) {
    return Response.json({ status: false, message: "Failed to submit application" }, { status: 500 })
  }

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null
  await logMembershipAuditEvent(
    {
      action: "mou_application_submitted",
      entityType: "mou_application",
      entityId: created.id,
      newData: {
        reference_number: created.reference_number,
        event_type: v.event_type,
        member_id: applicant.member_id,
        amasi_number: applicant.amasi_number,
        place: v.place,
        attachments: v.attachments.length,
      },
      performedBy: applicant.applicant_email,
      ipAddress: ip,
    },
    supabase
  )

  await sendMouSubmittedEmails({
    id: created.id,
    reference_number: created.reference_number,
    event_type: v.event_type,
    applicant_name: applicant.applicant_name,
    applicant_email: applicant.applicant_email,
    place: v.place,
    proposed_date: v.proposed_date,
    proposed_year: v.proposed_year,
  })

  return Response.json(
    {
      status: true,
      application: { id: created.id, reference_number: created.reference_number, status: "submitted" },
    },
    { status: 201 }
  )
}
