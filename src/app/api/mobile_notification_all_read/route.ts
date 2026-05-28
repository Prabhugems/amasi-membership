// @auth: public — legacy mobile shim. Mark-all-as-read for the member's
// notification inbox. No-op success — paired with mobile_notification_list
// which returns an empty inbox today; there is nothing to mark read.
// Flutter captures the response into an observable but never reads it
// (per migration/flutter-usage.md).
import { legacyOk } from "@/lib/mobile-shim"

export async function POST() {
  return legacyOk("OK")
}

export const GET = POST
