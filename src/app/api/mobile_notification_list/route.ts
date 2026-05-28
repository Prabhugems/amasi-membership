// @auth: public — legacy mobile shim. Returns the member's notification
// inbox (Flutter notification list screen + bottom-nav unread badge).
//
// Gap: amasi-membership has no per-member notification inbox table yet
// (`notification_logs` is the admin broadcast log, not a member inbox).
// Until that table lands, we return an empty list — strict improvement
// over the "feature updating" toast: the screen renders cleanly and the
// badge shows 0 instead of erroring on parse.
//
// To wire real data: create a `member_notifications` table and emit rows
// on approval/clarification/reject/announcement events, then point this
// route at it.

import { legacyOk } from "@/lib/mobile-shim"

export async function POST() {
  return legacyOk("OK", { data: [] })
}

export const GET = POST
