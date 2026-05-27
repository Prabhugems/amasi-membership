// @auth: public — legacy mobile shim stub. See migration/SHIM_README.md.
// (P0 sends the OTP via /common_member_send_otp; resend is non-P0 — users
// can re-tap Send OTP from the login screen.)
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("common_member_resend_otp")
}
export const GET = POST
