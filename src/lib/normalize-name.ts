// Defensive name-field normalization shared by every application/member
// write path (apply submit, auto-approval, admin approve, admin draft edit).
//
// The bug it prevents: members rows persisting `middle_name = first_name`
// (case- and whitespace-insensitive). The MCI-cert OCR auto-fill splits a
// name like "Shivani Shivani Samaiya" into [first="Shivani", middle="Shivani",
// last="Samaiya"] (apply/page.tsx ~line 1103), and applicants who type their
// first name into the middle-name field also hit it. Badges then render
// "Dr. Shivani Shivani Samaiya" because the badge generator concatenates
// salutation + first + middle + last. Cleaned 21 historical members on
// 2026-06-30 — snapshot at `members_middle_name_dup_2026_06_30_snapshot`.

function trimOrEmpty(s: string | null | undefined): string {
  return (s ?? "").trim()
}

/**
 * Returns `null` when middleName is empty OR a case-insensitive duplicate of
 * firstName; otherwise returns the trimmed middleName. Used at every write
 * boundary that persists `middle_name` so the bad state can't reach storage
 * regardless of which entry path produced it.
 */
export function normalizeMiddleName(
  firstName: string | null | undefined,
  middleName: string | null | undefined,
): string | null {
  const f = trimOrEmpty(firstName)
  const m = trimOrEmpty(middleName)
  if (!m) return null
  if (f && f.toLowerCase() === m.toLowerCase()) return null
  return m
}

/**
 * Composes a single display-friendly full name from the three parts after
 * deduplicating middle. Drops empties so we never produce "First  Last" with
 * a double space. Mirrors the inline `[first, middle, last].filter(Boolean).join(" ")`
 * pattern used across submit/approve/auto-approval — kept as a helper so
 * future callers can't forget to normalize middle first.
 */
export function buildFullName(
  firstName: string | null | undefined,
  middleName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return [trimOrEmpty(firstName), normalizeMiddleName(firstName, middleName) ?? "", trimOrEmpty(lastName)]
    .filter(Boolean)
    .join(" ")
}
