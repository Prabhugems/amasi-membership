// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubSurveyTokenFromEvent } from "@/lib/scrub-survey-token";

Sentry.init({
  dsn: "https://527b62463e741ecf9eebafa103fd9cb3@o4511263275286528.ingest.de.sentry.io/4511291570520144",

  // Add optional integrations for additional features
  // No session replay on the survey participant link: its URL is a credential.
  integrations:
    typeof window !== "undefined" && window.location.pathname.startsWith("/survey/")
      ? []
      : [Sentry.replayIntegration()],

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Define how likely Replay events are sampled.
  // This sets the sample rate to be 10%. You may want this to be 100% while
  // in development and sample at a lower rate in production
  replaysSessionSampleRate: 0.1,

  // Define how likely Replay events are sampled when an error occurs.
  replaysOnErrorSampleRate: 1.0,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Survey link tokens are credentials; keep them out of Sentry.
  beforeSend: (event) => scrubSurveyTokenFromEvent(event),
  beforeSendTransaction: (event) => scrubSurveyTokenFromEvent(event),
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
