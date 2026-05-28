// @auth: public — legacy mobile shim. Single-notification read-state toggle.
// No-op success — paired with mobile_notification_list which returns an
// empty inbox today; there is nothing to toggle. Flutter captures the
// response into an observable but never reads it.
import { legacyOk } from "@/lib/mobile-shim"

export async function POST() {
  return legacyOk("OK")
}

export const GET = POST
