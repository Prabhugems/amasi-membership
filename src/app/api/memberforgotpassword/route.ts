// @auth: public — legacy mobile shim stub. Forgot-password dies with the
// password tab; the new portal has no passwords. See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("memberforgotpassword")
}
export const GET = POST
