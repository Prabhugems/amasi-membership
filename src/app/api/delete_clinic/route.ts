// @auth: public — legacy mobile shim stub. The legacy version had no
// ownership check (data-loss vector). Real implementation requires
// getMemberSession() + verifyMemberOwnership. Until then, stub.
// See migration/SHIM_README.md.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("delete_clinic")
}
export const GET = POST
