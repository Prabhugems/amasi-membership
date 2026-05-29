// @auth: public — legacy mobile shim. Mark-all-as-read for a member's
// inbox. Flutter posts `member_id` (AMASI number int or UUID — same
// resolution as mobile_notification_list).
//
// See sql/036_member_notifications.sql.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const memberIdRaw = field(form, "member_id").trim()
    if (!memberIdRaw) return legacyErr("member_id is required")

    const supabase = createAdminClient()

    let memberId: string | null = null
    if (/^\d+$/.test(memberIdRaw)) {
      const { data: m, error: mErr } = await supabase
        .from("members")
        .select("id")
        .eq("amasi_number", parseInt(memberIdRaw, 10))
        .maybeSingle()
      if (mErr) {
        Sentry.captureException(mErr, {
          tags: { route: "shim/mobile_notification_all_read", phase: "amasi-lookup" },
        })
        return legacyErr("Something went wrong")
      }
      memberId = m?.id ?? null
    } else {
      memberId = memberIdRaw
    }

    if (!memberId) return legacyOk("OK")

    const { error } = await supabase
      .from("member_notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("member_id", memberId)
      .is("read_at", null)

    if (error) {
      Sentry.captureException(error, {
        tags: { route: "shim/mobile_notification_all_read", phase: "bulk-update" },
      })
      return legacyErr("Something went wrong")
    }

    return legacyOk("OK")
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "shim/mobile_notification_all_read" },
    })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST
