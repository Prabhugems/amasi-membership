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
