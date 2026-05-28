// @auth: public — legacy mobile shim. The Flutter v1.0.4+2 binary wires
// this to the "Login Password" tab (login.dart:118, default tab on first
// render). The new portal is OTP-only — the `members` table has no
// `password` column to authenticate against. We return a clear, actionable
// message instead of the generic "feature updating" toast so users see
// what to do.
//
// Drop this route entirely (along with the Password tab) in the next
// Flutter release.
//
// See migration/MIGRATION_FINDINGS.md §2 and migration/SHIM_README.md.

import { legacyErr } from "@/lib/mobile-shim"

export async function POST() {
  return legacyErr(
    "Password login is no longer supported. Please switch to the 'Login with OTP' tab to sign in."
  )
}

export const GET = POST
