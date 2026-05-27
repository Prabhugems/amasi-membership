// @auth: public — legacy mobile shim. Returns the state dropdown list for a
// given country_id. Defaults to 101 (India) per legacy behavior when the
// caller omits or empty-strings the id. See migration/backend-spec.md §19.

import type { NextRequest } from "next/server"
import { legacyOk, parseLegacyForm, field } from "@/lib/mobile-shim"
import { statesForCountry } from "@/lib/mobile-geo-data"

export async function POST(request: NextRequest) {
  const form = await parseLegacyForm(request)
  const raw = field(form, "id")
  const countryId = parseInt(raw, 10) || 101
  return legacyOk("States list.", { data: statesForCountry(countryId) })
}
