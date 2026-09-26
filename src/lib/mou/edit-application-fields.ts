// Server-side allowlist for PATCH /api/mou/applications/[id]/edit.
//
// This is pickApplicationInput()'s create-time allowlist
// (src/app/api/mou/applications/route.ts:85-116) minus fields that must
// stay locked once an application exists:
//
//   - email, phone_number: the OTP identity. Changing them mid-edit could
//     orphan the applicant's own edit/OTP access to their own application.
//   - application_type_id: changing it would invalidate the whole
//     type_specific_data shape and the already-signed MOU clause version.
//     (event_routing is never in either allowlist at all — it's derived
//     purely from type and only ever admin-mutated, see event-routing.ts.)
//   - agree_terms, certify_accurate, authority_confirm: one-time
//     attestations recorded alongside the original signature; a generic
//     edit form must not silently flip these back.
export const EDITABLE_MOU_APPLICATION_FIELDS = new Set<string>([
  "organizer_name",
  "applicant_amasi_number",
  "primary_institution",
  "event_name",
  "expected_participants",
  "live_surgery_demo",
  "preferred_date_1",
  "preferred_date_2",
  "venue_type",
  "venue_name",
  "venue_address",
  "venue_city",
  "venue_state",
  "venue_zip",
  "venue_country",
  "zone",
  "auditorium_hall_a",
  "auditorium_hall_b",
  "av_equipment",
  "endotrainers",
  "high_speed_internet",
  "committee_member_photo_url",
  "institution_photo_url",
  // mou-framework-only fields (rural_program/workshop) — harmless to allow
  // for other types since createApplication never wrote them in the first
  // place for those rows, so an edit touching them just becomes a no-op
  // diff against undefined/null.
  "amasi_year_of_joining",
  "designation",
  "proposed_registration_fee",
  "programme_outline",
  "institution_type",
  "joint_programme",
  "partner_associations",
  "consent_guest_institution_url",
  "brief_institution_url",
  "faculty",
  "agreements",
])

export function partitionMouEditableUpdates(
  updates: Record<string, unknown>
): { accepted: Record<string, unknown>; rejected: string[] } {
  const accepted: Record<string, unknown> = {}
  const rejected: string[] = []
  for (const [key, value] of Object.entries(updates)) {
    if (EDITABLE_MOU_APPLICATION_FIELDS.has(key)) {
      accepted[key] = value
    } else {
      rejected.push(key)
    }
  }
  return { accepted, rejected }
}
