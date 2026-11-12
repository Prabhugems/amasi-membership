import * as Sentry from "@sentry/nextjs"

/**
 * Resend's `emails.send()` does NOT throw on delivery/API failures — it resolves
 * with `{ data, error }`. Callers that only wrap it in try/catch therefore never
 * notice a failed send (bad key, unverified domain, rejected recipient). Pass the
 * result here so failures reach logs and Sentry instead of vanishing.
 */
export function reportEmailResult(
  result: { error?: { message?: string; name?: string } | null } | null | undefined,
  context: string,
): boolean {
  const error = result?.error
  if (!error) return true
  console.error(`[email] ${context} failed:`, error)
  Sentry.captureException(new Error(`Email send failed: ${context}: ${error.message ?? error.name ?? "unknown"}`), {
    tags: { component: "email", op: context },
  })
  return false
}
