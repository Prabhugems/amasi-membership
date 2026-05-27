// @auth: public — legacy mobile shim stub. The Flutter v1.0.4+2 binary wires
// this to the "Login Password" tab (login.dart:118, default tab on first
// render). The new portal is OTP-only; users should switch to the "Login
// with OTP" tab. We can't rewrite the screen without a Flutter release.
//
// See migration/MIGRATION_FINDINGS.md §2 and migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("check_common_login")
}
export const GET = POST
