// @auth: public — legacy mobile shim stub. The Flutter v1.0.4+2 binary uses
// this for wizard resume (7 call sites — see migration/flutter-usage.md).
// Stubbing means a user who quits the app mid-application restarts from
// scratch — acceptable for the emergency cutover since the affected drafts
// are in the dead legacy MySQL anyway. Implement against draft_applications
// in the P1 follow-up.
import { stubFeatureUpdating } from "@/lib/mobile-shim"

export async function POST() {
  return stubFeatureUpdating("member_info")
}
export const GET = POST
