// @auth: public — legacy mobile shim stub. The Flutter "CREATE FRESH"
// button (member_application.dart:6921) fires this then proceeds with
// /send_otp regardless of the response. Stubbing leaves the prior draft
// in place; the user may re-encounter the incomplete-application dialog.
// Real implementation needs ownership-checked deletion + draft cleanup.
// See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("delete_old_member_application")
}
export const GET = POST
