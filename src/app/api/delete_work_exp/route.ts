// @auth: public — legacy mobile shim stub. Same ownership-check gap as
// delete_clinic. See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("delete_work_exp")
}
export const GET = POST
