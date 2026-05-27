// @auth: public — legacy mobile shim stub. See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("check_user_data")
}
export const GET = POST
