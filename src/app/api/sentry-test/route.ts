// @auth: public — Sentry SDK smoke test; intentionally open so anyone can
// confirm the error pipeline is wired up end-to-end.
import * as Sentry from "@sentry/nextjs"

export async function GET() {
  try {
    throw new Error("Sentry test error — this is intentional")
  } catch (error) {
    Sentry.captureException(error)
    return Response.json({ status: true, message: "Test error sent to Sentry" })
  }
}
