import * as Sentry from "@sentry/nextjs"

Sentry.init({
  dsn: "https://472c15996385cf5e648355cf864edaf1@o4511263275286528.ingest.de.sentry.io/4511263278563408",
  tracesSampleRate: 0.1,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.NODE_ENV || "development",
  ignoreErrors: [
    "ResizeObserver loop",
    "ResizeObserver loop completed with undelivered notifications",
    "NetworkError when attempting to fetch resource",
    "Failed to fetch",
    "Load failed",
    "AbortError",
  ],
  beforeSend(event) {
    // Drop browser extension errors
    if (event.exception?.values?.[0]?.stacktrace?.frames?.some(
      (f) => f.filename?.includes("extension://") || f.filename?.includes("inject")
    )) {
      return null
    }
    return event
  },
})
