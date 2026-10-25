// The survey participant link token (/survey/<token>, /api/survey/<token>) is a
// working credential. Telemetry (Sentry events and transactions, Vercel
// Analytics, Speed Insights) records URLs, so strip the token before anything
// leaves the process or the browser.

const SURVEY_TOKEN_RE = /(\/(?:api\/)?survey\/)[A-Za-z0-9_-]{43}/g

export function scrubSurveyToken(text: string): string {
  return text.replace(SURVEY_TOKEN_RE, "$1[token]")
}

/** Sentry beforeSend / beforeSendTransaction: rewrite every URL-ish string in the event. */
export function scrubSurveyTokenFromEvent<T>(event: T): T {
  const json = JSON.stringify(event)
  if (!json?.includes("survey/")) return event
  const scrubbed = scrubSurveyToken(json)
  return scrubbed === json ? event : (JSON.parse(scrubbed) as T)
}
