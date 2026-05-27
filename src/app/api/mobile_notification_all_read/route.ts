// @auth: public — legacy mobile shim stub. See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("mobile_notification_all_read")
}
export const GET = POST
