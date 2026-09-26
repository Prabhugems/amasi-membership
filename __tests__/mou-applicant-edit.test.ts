import { describe, it, expect, vi, beforeEach } from "vitest"
import { createMockSupabase } from "./mou-supabase-mock"
import type { AcademicEventApplication } from "@/lib/mou/types"

const { mockClient } = vi.hoisted(() => ({
  mockClient: { current: null as ReturnType<typeof import("./mou-supabase-mock").createMockSupabase> | null },
}))
vi.mock("@/lib/supabase", () => ({
  createAdminClient: () => mockClient.current,
}))
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: 0 }),
}))
vi.mock("@/lib/mou/notify", () => ({
  sendApplicationUpdatedNotice: vi.fn(),
  sendResubmissionNotice: vi.fn(),
  sendChangeRequestNotice: vi.fn(),
  sendChangeRequestOutcomeEmail: vi.fn(),
}))
vi.mock("@/lib/audit-log", () => ({
  logMembershipAuditEvent: vi.fn(),
  logAdminAction: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  getAdminSession: vi.fn(async () => ({ email: "admin@test.com", name: "Test Admin" })),
}))

import { createEditToken, verifyEditToken, revokeEditToken } from "@/lib/mou/edit-token"
import { resolveApplicantCredential } from "@/lib/mou/applicant-auth"
import { partitionMouEditableUpdates, EDITABLE_MOU_APPLICATION_FIELDS } from "@/lib/mou/edit-application-fields"
import { computeFieldDiff } from "@/lib/edit-application-fields"
import { PATCH as editPatch } from "@/app/api/mou/applications/[id]/edit/route"
import { POST as changeRequestPost } from "@/app/api/mou/applications/[id]/change-request/route"
import { POST as decideChangeRequestPost } from "@/app/api/admin/mou-applications/[id]/change-requests/[requestId]/decide/route"
import { sendResubmissionNotice, sendApplicationUpdatedNotice } from "@/lib/mou/notify"

// Route handlers take Next's typed NextRequest + { params: Promise<...> }
// context; tests only need a plain Request with a .json() body. One `any`,
// isolated here, instead of the dozen inline `as any` casts this replaces
// — same escape hatch __tests__/mou-api-applications.test.ts uses per call
// site, just centralized into one helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callRoute(handler: any, req: Request, params: Record<string, string>): Promise<Response> {
  return handler(req, { params: Promise.resolve(params) })
}

// Cast to a plain index-signature record — this file only ever uses this
// fixture to seed createMockSupabase's tables (a Record<string, unknown>[]
// per table), never to call a function that expects the precise
// AcademicEventApplication type (unlike mou-event-routing.test.ts).
function baseApplication(overrides: Partial<AcademicEventApplication> = {}): Record<string, unknown> {
  return {
    id: "app-1",
    application_type_id: "fmas",
    status: "submitted",
    applicant_amasi_number: null,
    applicant_member_id: null,
    organizer_name: "Dr. Test",
    email: "test@example.com",
    phone_number: "9999999999",
    otp_verified_at: null,
    primary_institution: "Test Hospital",
    event_name: null,
    expected_participants: null,
    live_surgery_demo: null,
    preferred_date_1: "2026-12-01",
    preferred_date_2: null,
    finalized_date: null,
    venue_type: null,
    venue_name: "Test Auditorium",
    venue_address: null,
    venue_city: "Chennai",
    venue_state: "Tamil Nadu",
    venue_zip: null,
    venue_country: "India",
    zone: null,
    auditorium_hall_a: false,
    auditorium_hall_b: false,
    av_equipment: false,
    endotrainers: false,
    high_speed_internet: false,
    agree_terms: true,
    certify_accurate: true,
    authority_confirm: true,
    committee_member_photo_url: null,
    institution_photo_url: null,
    amasi_year_of_joining: null,
    designation: null,
    proposed_registration_fee: null,
    programme_outline: null,
    institution_type: null,
    joint_programme: false,
    partner_associations: [],
    consent_guest_institution_url: null,
    brief_institution_url: null,
    faculty: [],
    agreements: null,
    type_specific_data: {},
    mou_generated_url: null,
    mou_version: 0,
    created_event_id: null,
    reviewed_by: null,
    reviewed_at: null,
    rejection_reason: null,
    admin_notes: null,
    published_at: null,
    report_documents: [],
    report_notes: null,
    report_submitted_at: null,
    report_reminder_7_sent_at: null,
    report_reminder_15_sent_at: null,
    report_escalation_sent_at: null,
    report_status: null,
    report_reviewed_by: null,
    report_reviewed_at: null,
    report_return_note: null,
    registration_required: null,
    event_routing: "college",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

function seedRoleAssignment() {
  return [
    {
      role: "hon_secretary",
      name: "Hon. Secretary",
      email: "secretary@example.com",
      phone: null,
      active_from: "2020-01-01",
      active_to: null,
    },
  ]
}

function jsonRequest(body: unknown) {
  return new Request("http://test", { method: "POST", body: JSON.stringify(body) })
}

describe("edit-token", () => {
  beforeEach(() => {
    mockClient.current = createMockSupabase({ academic_event_edit_tokens: [] })
  })

  it("creates a token and verifies it successfully", async () => {
    const raw = await createEditToken("app-1")
    const result = await verifyEditToken(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.row.application_id).toBe("app-1")
  })

  it("rejects an unknown token", async () => {
    const result = await verifyEditToken("not-a-real-token")
    expect(result.ok).toBe(false)
  })

  it("rejects an expired token", async () => {
    const raw = await createEditToken("app-1", -1) // already expired
    const result = await verifyEditToken(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("expired")
  })

  it("rejects a revoked token", async () => {
    const raw = await createEditToken("app-1")
    await revokeEditToken("app-1")
    const result = await verifyEditToken(raw)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toContain("revoked")
  })

  it("verify succeeds on the token itself but the caller must independently reject a mismatched application id (IDOR boundary)", async () => {
    const raw = await createEditToken("app-1")
    const result = await verifyEditToken(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.row.application_id).not.toBe("app-2")
  })
})

describe("resolveApplicantCredential", () => {
  beforeEach(() => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication()],
      academic_event_edit_tokens: [],
      otp_codes: [],
    })
  })

  it("succeeds via a valid edit token scoped to the right application", async () => {
    const raw = await createEditToken("app-1")
    const result = await resolveApplicantCredential("app-1", { editToken: raw })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.via).toBe("edit_token")
  })

  it("rejects a token minted for a DIFFERENT application (IDOR)", async () => {
    mockClient.current!._setTable("academic_event_applications", [baseApplication(), baseApplication({ id: "app-2", email: "other@example.com" })])
    const raw = await createEditToken("app-2")
    const result = await resolveApplicantCredential("app-1", { editToken: raw })
    expect(result.ok).toBe(false)
  })

  it("succeeds via a verified OTP for the application's own email within the window", async () => {
    mockClient.current!._setTable("otp_codes", [
      { id: "otp-1", email: "test@example.com", verified: true, created_at: new Date().toISOString() },
    ])
    const result = await resolveApplicantCredential("app-1", { email: "test@example.com" })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.via).toBe("otp")
  })

  it("rejects a verified OTP for the CALLER's own email when it doesn't match the application's email (core IDOR test)", async () => {
    mockClient.current!._setTable("otp_codes", [
      { id: "otp-1", email: "attacker@example.com", verified: true, created_at: new Date().toISOString() },
    ])
    const result = await resolveApplicantCredential("app-1", { email: "attacker@example.com" })
    expect(result.ok).toBe(false)
  })

  it("rejects an OTP verified outside the 2h window", async () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    mockClient.current!._setTable("otp_codes", [{ id: "otp-1", email: "test@example.com", verified: true, created_at: threeHoursAgo }])
    const result = await resolveApplicantCredential("app-1", { email: "test@example.com" })
    expect(result.ok).toBe(false)
  })

  it("returns 401 when no credential is provided at all", async () => {
    const result = await resolveApplicantCredential("app-1", {})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })
})

describe("edit-application-fields", () => {
  it("rejects locked fields (email, phone_number, application_type_id, attestation booleans)", () => {
    const { accepted, rejected } = partitionMouEditableUpdates({
      email: "new@example.com",
      phone_number: "111",
      application_type_id: "nextgen",
      agree_terms: false,
      certify_accurate: false,
      authority_confirm: false,
      organizer_name: "New Name",
    })
    expect(rejected.sort()).toEqual(
      ["email", "phone_number", "application_type_id", "agree_terms", "certify_accurate", "authority_confirm"].sort()
    )
    expect(accepted).toEqual({ organizer_name: "New Name" })
  })

  it("accepts every field in the allowlist", () => {
    const updates = Object.fromEntries([...EDITABLE_MOU_APPLICATION_FIELDS].map((k) => [k, "x"]))
    const { rejected } = partitionMouEditableUpdates(updates)
    expect(rejected).toEqual([])
  })

  it("computeFieldDiff produces the expected {from, to} shape", () => {
    const diff = computeFieldDiff({ organizer_name: "Old Name", venue_city: "Chennai" }, { organizer_name: "New Name" })
    expect(diff.fieldCount).toBe(1)
    expect(diff.changes.organizer_name).toEqual({ from: "Old Name", to: "New Name" })
  })
})

describe("PATCH /api/mou/applications/[id]/edit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("plain edit while submitted: updates fields, status unchanged, no new token minted", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "submitted" })],
      academic_event_edit_tokens: [],
      academic_event_application_revisions: [],
      academic_event_approval_tokens: [],
      academic_event_role_assignments: seedRoleAssignment(),
    })
    const raw = await createEditToken("app-1")

    const res = await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { organizer_name: "Updated Name" } }), { id: "app-1" })
    const body = await res.json()
    expect(body.status).toBe(true)
    expect(body.changed).toBe(true)
    expect(body.resubmitted).toBe(false)

    const [updatedApp] = mockClient.current._tables.get("academic_event_applications")!
    expect(updatedApp.organizer_name).toBe("Updated Name")
    expect(updatedApp.status).toBe("submitted")
    expect(mockClient.current._tables.get("academic_event_approval_tokens")!.length).toBe(0)
    expect(sendApplicationUpdatedNotice).toHaveBeenCalledTimes(1)
    expect(sendResubmissionNotice).not.toHaveBeenCalled()
  })

  it("resubmit from changes_requested: flips status to submitted, mints a fresh can_decide token, inserts a resubmit revision, does not touch mou_signatures", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "changes_requested" })],
      academic_event_edit_tokens: [],
      academic_event_application_revisions: [],
      academic_event_approval_tokens: [],
      academic_event_role_assignments: seedRoleAssignment(),
      mou_signatures: [],
    })
    const raw = await createEditToken("app-1")

    const res = await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { venue_city: "Mumbai" } }), { id: "app-1" })
    const body = await res.json()
    expect(body.resubmitted).toBe(true)

    const [updatedApp] = mockClient.current._tables.get("academic_event_applications")!
    expect(updatedApp.status).toBe("submitted")
    expect(updatedApp.venue_city).toBe("Mumbai")

    const tokens = mockClient.current._tables.get("academic_event_approval_tokens")!
    expect(tokens.length).toBe(1)
    expect(tokens[0].can_decide).toBe(true)
    expect(tokens[0].role).toBe("hon_secretary")

    const revisions = mockClient.current._tables.get("academic_event_application_revisions")!
    expect(revisions.length).toBe(1)
    expect(revisions[0].change_source).toBe("applicant_resubmit")

    expect(mockClient.current._tables.get("mou_signatures")!.length).toBe(0)
    expect(sendResubmissionNotice).toHaveBeenCalledTimes(1)
  })

  it("blocks editing an approved application", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "approved" })],
      academic_event_edit_tokens: [],
    })
    const raw = await createEditToken("app-1")
    const res = await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { organizer_name: "X" } }), { id: "app-1" })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.status).toBe(false)
  })

  it("blocks editing a rejected application", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "rejected" })],
      academic_event_edit_tokens: [],
    })
    const raw = await createEditToken("app-1")
    const res = await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { organizer_name: "X" } }), { id: "app-1" })
    expect(res.status).toBe(400)
  })

  it("rejects an unknown/locked field with no partial write", async () => {
    const app = baseApplication({ status: "submitted" })
    mockClient.current = createMockSupabase({
      academic_event_applications: [app],
      academic_event_edit_tokens: [],
    })
    const raw = await createEditToken("app-1")
    const res = await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { organizer_name: "Updated", email: "new@example.com" } }), { id: "app-1" })
    expect(res.status).toBe(400)
    const [row] = mockClient.current._tables.get("academic_event_applications")!
    expect(row.organizer_name).toBe(app.organizer_name) // unchanged — no partial write
  })

  it("zero-diff update: changed=false, no revision row, no email sent", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "submitted", organizer_name: "Same Name" })],
      academic_event_edit_tokens: [],
      academic_event_application_revisions: [],
      academic_event_role_assignments: seedRoleAssignment(),
    })
    const raw = await createEditToken("app-1")
    const res = await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { organizer_name: "Same Name" } }), { id: "app-1" })
    const body = await res.json()
    expect(body.changed).toBe(false)
    expect(mockClient.current._tables.get("academic_event_application_revisions")!.length).toBe(0)
    expect(sendApplicationUpdatedNotice).not.toHaveBeenCalled()
  })

  it("two sequential edits on one application both persist distinct revision rows", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "submitted" })],
      academic_event_edit_tokens: [],
      academic_event_application_revisions: [],
      academic_event_role_assignments: seedRoleAssignment(),
    })
    const raw = await createEditToken("app-1")
    await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { organizer_name: "First Edit" } }), { id: "app-1" })
    await callRoute(editPatch, jsonRequest({ editToken: raw, updates: { organizer_name: "Second Edit" } }), { id: "app-1" })
    expect(mockClient.current._tables.get("academic_event_application_revisions")!.length).toBe(2)
  })
})

describe("POST /api/mou/applications/[id]/change-request", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("blocks a change request while the application is still submitted", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "submitted" })],
      academic_event_edit_tokens: [],
      academic_event_change_requests: [],
    })
    const raw = await createEditToken("app-1")
    const res = await callRoute(changeRequestPost, jsonRequest({ editToken: raw, requestedDate: "2027-01-01", note: "moved" }), { id: "app-1" })
    expect(res.status).toBe(400)
  })

  it("blocks a second pending request while one already exists", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "approved" })],
      academic_event_edit_tokens: [],
      academic_event_change_requests: [{ id: "cr-1", application_id: "app-1", status: "pending" }],
      academic_event_role_assignments: seedRoleAssignment(),
    })
    const raw = await createEditToken("app-1")
    const res = await callRoute(changeRequestPost, jsonRequest({ editToken: raw, requestedDate: "2027-01-01", note: "moved again" }), { id: "app-1" })
    expect(res.status).toBe(400)
  })

  it("submits successfully for an approved application with no pending request", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "approved" })],
      academic_event_edit_tokens: [],
      academic_event_change_requests: [],
      academic_event_role_assignments: seedRoleAssignment(),
    })
    const raw = await createEditToken("app-1")
    const res = await callRoute(changeRequestPost, jsonRequest({ editToken: raw, requestedDate: "2027-01-01", note: "venue flooded" }), { id: "app-1" })
    expect(res.status).toBe(200)
    const requests = mockClient.current._tables.get("academic_event_change_requests")!
    expect(requests.length).toBe(1)
    expect(requests[0].status).toBe("pending")
  })
})

describe("POST .../change-requests/[requestId]/decide (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("approved: updates finalized_date and syncs the linked event's date", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "approved", created_event_id: "event-1", finalized_date: null })],
      academic_event_change_requests: [
        { id: "cr-1", application_id: "app-1", status: "pending", requested_date: "2027-02-15", requested_venue: null, requested_faculty: null },
      ],
      events: [{ id: "event-1", start_date: "2026-12-01", end_date: "2026-12-01" }],
    })
    const res = await callRoute(decideChangeRequestPost, jsonRequest({ action: "approved" }), { id: "app-1", requestId: "cr-1" })
    expect(res.status).toBe(200)

    const [app] = mockClient.current._tables.get("academic_event_applications")!
    expect(app.finalized_date).toBe("2027-02-15")

    const [event] = mockClient.current._tables.get("events")!
    expect(event.start_date).toBe("2027-02-15")

    const [cr] = mockClient.current._tables.get("academic_event_change_requests")!
    expect(cr.status).toBe("approved")
  })

  it("declined: never mutates finalized_date or the linked event", async () => {
    mockClient.current = createMockSupabase({
      academic_event_applications: [baseApplication({ status: "approved", created_event_id: "event-1", finalized_date: null })],
      academic_event_change_requests: [
        { id: "cr-1", application_id: "app-1", status: "pending", requested_date: "2027-02-15", requested_venue: null, requested_faculty: null },
      ],
      events: [{ id: "event-1", start_date: "2026-12-01", end_date: "2026-12-01" }],
    })
    const res = await callRoute(decideChangeRequestPost, jsonRequest({ action: "declined", decisionNote: "not feasible" }), {
      id: "app-1",
      requestId: "cr-1",
    })
    expect(res.status).toBe(200)

    const [app] = mockClient.current._tables.get("academic_event_applications")!
    expect(app.finalized_date).toBeNull()
    const [event] = mockClient.current._tables.get("events")!
    expect(event.start_date).toBe("2026-12-01")
    const [cr] = mockClient.current._tables.get("academic_event_change_requests")!
    expect(cr.status).toBe("declined")
  })
})
