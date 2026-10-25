// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubSurveyTokenFromEvent } from "@/lib/scrub-survey-token";

Sentry.init({
  dsn: "https://527b62463e741ecf9eebafa103fd9cb3@o4511263275286528.ingest.de.sentry.io/4511291570520144",

  // Explicit environment so a stray VERCEL_ENV in .env.local can't cause
  // local dev errors to be tagged as production (see AMASI-MEMBERSHIP-8).
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",

  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true,

  // Survey link tokens are credentials; keep them out of Sentry.
  beforeSend: (event) => scrubSurveyTokenFromEvent(event),
  beforeSendTransaction: (event) => scrubSurveyTokenFromEvent(event),

  // Drop benign client-disconnect noise that surfaces as uncaught Node
  // socket errors but has no in-app frames and no user impact.
  ignoreErrors: ["aborted", "ECONNRESET", "EPIPE"],
});
