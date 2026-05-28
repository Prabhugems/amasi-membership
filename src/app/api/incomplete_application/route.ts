// @auth: public — legacy cron-target shim.
//
// The pre-2026-05-27 backend exposed GET /incomplete_application as a side-effect
// cron endpoint that scanned tbl_member for application_status=0 rows older than
// 24h and emailed reminders. An external HTTP cron provider was firing it daily
// against application.amasi.org; after the DNS cutover those calls now land on
// membership.amasi.org and trip the middleware 401 (AMASI-MEMBERSHIP-2V).
//
// We already run the equivalent reminder job server-side at
// /api/cron/bulk-draft-reminders (see src/lib/bulk-draft-reminders.ts), so this
// route is a deliberate no-op that mirrors the legacy "nothing to do" envelope
// to keep the upstream cron quiet until it can be located and disabled at the
// provider.
import { legacyOk } from "@/lib/mobile-shim"

export async function GET() {
  return legacyOk("No incomplete applications found.")
}
export const POST = GET
