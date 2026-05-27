// @auth: public — legacy mobile shim stub. See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("send_details_toMail")
}
export const GET = POST
