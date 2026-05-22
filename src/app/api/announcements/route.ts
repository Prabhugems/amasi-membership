// @auth: public — announcements are broadcast content with no PII; the handler
// only returns published rows with audience='public', so anonymous access is
// safe by construction. IP rate-limited below.
import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

// GET /api/announcements — public list of member-facing announcements.
//
// Auth: anonymous. The data has no PII or member-tier distinction
// (unlike /api/members/search). Bearer tokens are not parsed here —
// callers who want audience='members' content should hit a future
// authed variant; this endpoint deliberately only ever returns
// audience='public' rows so a leak is structurally impossible.
//
// Rate limit: 60 per 15 minutes per IP (mirrors the anonymous tier of
// /api/members/search).
//
// Hardening: .throwOnError() on the query + Sentry capture in the
// outer catch, so a schema regression on the SELECT list (the bug
// class from 49bbbfe → c791ac0) doesn't masquerade as an empty list.

const ANNOUNCEMENT_SELECT = "id, title, body, created_at, updated_at"
const MAX_ROWS = 50

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`announcements:${ip}`, 60, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many requests", data: [] },
      { status: 429 }
    )
  }

  try {
    const supabase = createAdminClient()
    const { data } = await supabase
      .from("announcements")
      .select(ANNOUNCEMENT_SELECT)
      .eq("published", true)
      .eq("audience", "public")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS)
      .throwOnError()

    if (data && data.length > 0) {
      return Response.json({ status: true, message: "OK", data })
    }
    return Response.json({ status: false, message: "No announcements", data: [] })
  } catch (error: unknown) {
    console.error("Announcements list error:", error)
    Sentry.captureException(error, { tags: { flow: "announcements_list" } })
    return Response.json(
      { status: false, message: "Failed to load announcements", data: [] },
      { status: 500 }
    )
  }
}
