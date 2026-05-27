// @auth: public — legacy mobile shim. Returns the country dropdown list for
// the Flutter apply wizard. See migration/backend-spec.md §18.

import { legacyOk } from "@/lib/mobile-shim"
import { COUNTRIES } from "@/lib/mobile-geo-data"

export async function GET() {
  return legacyOk("Country list.", { data: COUNTRIES })
}
