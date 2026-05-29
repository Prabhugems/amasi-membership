// @auth: public — legacy mobile shim. Returns the member's notification
// inbox (Flutter notification list screen + bottom-nav unread badge).
//
// Reads from `member_notifications` (sql/036). Flutter posts `member_id`
// which is the value Flutter stored in Hive after OTP verify — for
// approved members that's the AMASI number (int), and the legacy contract
// also accepted raw row ids. We branch on shape: numeric → look up
// `members.amasi_number`; UUID-shaped → use `members.id` directly.
//
// Response shape per migration/flutter-usage.md row 9:
//   {status:true, data:[{id, title, body, notify_image, url, read_status, ...}]}
// `read_status` is the legacy 1=unread, 2=read int. We map from null/timestamp.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

const MAX_ROWS = 50

export async function POST(request: NextRequest) {
  try {
    const form = await parseLegacyForm(request)
    const memberIdRaw = field(form, "member_id").trim()
    if (!memberIdRaw) return legacyErr("member_id is required")

    const supabase = createAdminClient()

    // Resolve memberId — accept AMASI number (int from Flutter's int? cast)
    // or UUID (members.id).
    let memberId: string | null = null
    if (/^\d+$/.test(memberIdRaw)) {
      const { data: m, error: mErr } = await supabase
        .from("members")
        .select("id")
        .eq("amasi_number", parseInt(memberIdRaw, 10))
        .maybeSingle()
      if (mErr) {
        Sentry.captureException(mErr, {
          tags: { route: "shim/mobile_notification_list", phase: "amasi-lookup" },
        })
        return legacyErr("Something went wrong")
      }
      memberId = m?.id ?? null
    } else {
      memberId = memberIdRaw
    }

    if (!memberId) {
      // No member matched — return empty list (treat as "no notifications")
      // rather than erroring; the Flutter binary's bottom-nav badge polls
      // this on app start and a 500 here would cause visible failures.
      return legacyOk("OK", { data: [] })
    }

    const { data: rows, error } = await supabase
      .from("member_notifications")
      .select("id, title, body, image_url, action_url, read_at, created_at")
      .eq("member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS)

    if (error) {
      // Degrade to empty list (not an error toast) — covers the brief
      // pre-migration window where member_notifications doesn't exist yet,
      // and any future schema drift. Bell shows 0 instead of breaking.
      Sentry.captureException(error, {
        tags: { route: "shim/mobile_notification_list", phase: "list-query" },
      })
      return legacyOk("OK", { data: [] })
    }

    // Legacy shape: rows use snake_case + integer read_status (1=unread, 2=read).
    const data = (rows ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      notify_image: r.image_url ?? "",
      url: r.action_url ?? "",
      read_status: r.read_at ? 2 : 1,
      created_on: r.created_at,
    }))

    return legacyOk("OK", { data })
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "shim/mobile_notification_list" },
    })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST
