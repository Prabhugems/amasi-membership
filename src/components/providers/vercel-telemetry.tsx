"use client"

import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { scrubSurveyToken } from "@/lib/scrub-survey-token"

// Survey link tokens are credentials; strip them from the URLs Vercel records.
export function VercelTelemetry() {
  return (
    <>
      <SpeedInsights beforeSend={(data) => ({ ...data, url: scrubSurveyToken(data.url) })} />
      <Analytics beforeSend={(event) => ({ ...event, url: scrubSurveyToken(event.url) })} />
    </>
  )
}
