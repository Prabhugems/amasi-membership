// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://527b62463e741ecf9eebafa103fd9cb3@o4511263275286528.ingest.de.sentry.io/4511291570520144",

  // Explicit environment so a stray VERCEL_ENV in .env.local can't cause
  // local dev errors to be tagged as production (see AMASI-MEMBERSHIP-8).
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",

  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true,

  ignoreErrors: ["aborted", "ECONNRESET", "EPIPE"],
});
