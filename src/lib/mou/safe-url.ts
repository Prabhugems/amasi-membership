// Shared with the admin detail view and the Secretary's review page — both
// render applicant-supplied URLs (consent letters, uploaded documents) as
// clickable links. The write path (pickApplicationInput) only validates
// these as strings, not as same-origin storage URLs, so a value like
// "javascript:..." would execute in the viewer's authenticated session the
// moment they click it. Only ever render http(s) links.
export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value) return false
  try {
    const u = new URL(value)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
}
