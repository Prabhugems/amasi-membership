import * as Sentry from "@sentry/node";

Sentry.init({
  dsn: "https://527b62463e741ecf9eebafa103fd9cb3@o4511263275286528.ingest.de.sentry.io/4511291570520144",
  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true,
});

const eventId = Sentry.captureException(
  new Error("Sentry integration test from scripts/sentry-test-error.mjs"),
);

console.log("Captured event id:", eventId);

const delivered = await Sentry.flush(2000);
console.log("Flushed within 2s:", delivered);

process.exit(delivered ? 0 : 1);
