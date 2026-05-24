// Server-only runtime feature flags. Read process.env directly so toggling
// only requires a Vercel env-var change (no rebuild). Do NOT prefix with
// NEXT_PUBLIC_ — these must never reach the browser bundle.
//
// Each flag defaults to OFF. Production stays OFF until a flag is proven
// on Preview with WS-B test keys; the flip is its own checkpoint.

function readBool(name: string): boolean {
  return process.env[name] === "true"
}

export const featureFlags = {
  /** WS-C: create membership_applications row at status='pending_payment'
   *  immediately after OTP verify, before payment. Off in production until
   *  validated end-to-end on Preview. */
  wscEarlyApplication: () => readBool("WSC_EARLY_APPLICATION_ENABLED"),
} as const
