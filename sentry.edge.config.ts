import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: "https://472c15996385cf5e648355cf864edaf1@o4511263275286528.ingest.de.sentry.io/4511263278563408",
  tracesSampleRate: 0.1,
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
})
