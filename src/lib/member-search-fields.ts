// Column lists for /api/members/search. Extracted from the route so tests
// can import them and assert they only reference real columns on the
// `members` table — the route's swallowed-error fallback turns a column
// typo (the `mobile` vs `phone` regression in 49bbbfe) into a silent
// "No data found" for every authed-member call.

// Public-safe field list for anonymous callers. Excludes PII such as email,
// phone, DOB, address, MCI number/state, and all document URLs except photo.
export const PUBLIC_SELECT =
  "id, name, membership_type, amasi_number, city, state, zone, pg_degree, status, profile_photo"

// Authenticated-member field list: PUBLIC_SELECT plus contact fields the
// mobile member-directory needs for mailto:/tel: actions. Still excludes
// DOB, address, MCI, and document URLs. NOTE: the column is `phone`
// (bigint), not `mobile`.
export const MEMBER_SELECT = `${PUBLIC_SELECT}, email, phone, mobile_code`

// A signed-in member's OWN record. MEMBER_SELECT deliberately omits DOB,
// address, MCI details and document links so that browsing other members
// stays privacy-safe, but the portal and /profile load the member's own row
// through the same endpoint. Without these columns a member's saved profile
// and documents came back blank after the next login ("my changes are gone",
// "documents show pending") even though every save had reached the database.
// Only ever applied to the row whose email matches the caller's session.
export const SELF_EXTRA_SELECT = [
  "salutation", "father_name", "date_of_birth", "gender", "nationality",
  "landline", "std_code",
  "street_address_1", "street_address_2", "country", "postal_code",
  "edu_undergrad_degree", "ug_college", "ug_university", "ug_year",
  "pg_college", "pg_university", "pg_year",
  "edu_superspecialty_degree", "edu_superspecialty_college",
  "edu_superspecialty_university", "edu_superspecialty_year",
  "mci_council_number", "mci_council_state", "imr_registration_no",
  "asi_membership_no", "asi_state",
  "mci_certificate", "pg_degree_certificate", "asi_member_certificate",
  "mbbs_degree_certificate", "active_license", "letter_hod",
  "voting_eligible", "application_no", "application_date", "joining_date", "created_at",
].join(", ")

export const SELF_SELECT = `${MEMBER_SELECT}, ${SELF_EXTRA_SELECT}`
