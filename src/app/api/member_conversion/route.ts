// @auth: public — legacy mobile shim stub. ACM-to-LM conversion path uses
// the new portal's /api/members/upgrade route — Flutter would need a code
// change to call that endpoint with new field shapes. Defer to P1.
// See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("member_conversion")
}
export const GET = POST
