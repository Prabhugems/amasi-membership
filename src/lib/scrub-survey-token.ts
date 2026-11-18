// The survey participant link token (/survey/<token>, /api/survey/<token>) is a
// working credential. Telemetry (Sentry events and transactions, Vercel
// Analytics, Speed Insights) records URLs, so strip the token before anything
// leaves the process or the browser.

const SURVEY_TOKEN_RE = /(\/(?:api\/)?survey\/)[A-Za-z0-9_-]{43}/g

export function scrubSurveyToken(text: string): string {
  return text.replace(SURVEY_TOKEN_RE, "$1[token]")
}

/**
 * Sentry beforeSend / beforeSendTransaction: rewrite every URL-ish string in
 * the event.
 *
 * It must never throw: a throw here is itself reported to Sentry as an error.
 * It used to call plain JSON.stringify(event), which throws "Converting
 * circular structure to JSON" on server events and transactions that hold
 * circular references -- about one error per request, which used up the whole
 * Sentry org's error quota (Nov 2026) and hid every other app's errors.
 *
 * Now: serialise with loops cut ("[Circular]"), scrub, and return the scrubbed
 * copy (only when a token was present -- otherwise the event is untouched).
 * If serialising still fails for any other reason, scrub in place instead.
 */
export function scrubSurveyTokenFromEvent<T>(event: T): T {
  let json: string | undefined
  try {
    json = JSON.stringify(event, loopSafeReplacer())
  } catch {
    scrubInPlace(event)
    return event
  }
  if (!json?.includes("survey/")) return event
  const scrubbed = scrubSurveyToken(json)
  if (scrubbed === json) return event
  try {
    return JSON.parse(scrubbed) as T
  } catch {
    scrubInPlace(event)
    return event
  }
}

// Replaces a value with "[Circular]" when it is one of its own ancestors.
function loopSafeReplacer() {
  const ancestors: object[] = []
  return function (this: unknown, _key: string, value: unknown) {
    if (value === null || typeof value !== "object") return value
    // `this` is the object holding `value`; drop ancestors we have left.
    while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) ancestors.pop()
    if (ancestors.includes(value)) return "[Circular]"
    ancestors.push(value)
    return value
  }
}

function scrubInPlace(event: unknown): void {
  try {
    walk(event, new WeakSet())
  } catch {
    // Never let telemetry scrubbing break telemetry.
  }
}

function walk(node: unknown, seen: WeakSet<object>): void {
  if (node === null || typeof node !== "object" || seen.has(node)) return
  seen.add(node)
  const record = node as Record<string, unknown>
  for (const key of Object.keys(record)) {
    let value: unknown
    try {
      value = record[key]
    } catch {
      continue
    }
    if (typeof value === "string") {
      if (!value.includes("survey/")) continue
      const scrubbed = scrubSurveyToken(value)
      if (scrubbed === value) continue
      try {
        record[key] = scrubbed
      } catch {
        // Read-only: nothing more can be done in place.
      }
    } else if (value !== null && typeof value === "object") {
      walk(value, seen)
    }
  }
}
