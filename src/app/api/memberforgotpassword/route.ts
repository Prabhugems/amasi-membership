// @auth: public — legacy mobile shim. Forgot-password dies with the
// password tab; the new portal has no passwords. Return a clear pointer
// to the OTP login flow instead of the generic stub message.
//
// See migration/SHIM_README.md.

import { legacyErr } from "@/lib/mobile-shim"

export async function POST() {
  return legacyErr(
    "Password reset isn't needed — sign in with the 'Login with OTP' tab and you'll receive a verification code by email."
  )
}

export const GET = POST
