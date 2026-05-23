// @auth: public — listing of upcoming public events for the mobile app; safe field whitelist below.
import { NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"

// Public, anonymous read endpoint for the mobile Events screen.
// Returns ONLY a safe, hard-coded column set — never `*` — because the
// `public.events` table mixes display data with razorpay_key_secret,
// razorpay_webhook_secret, and bank account fields. The shared RLS on
// that table is currently `USING (true)` for the anon role; this
// endpoint is the only place membership controls what gets exposed to
// clients that don't go through the Supabase anon key directly.

const SAFE_FIELDS = [
  "id",
  "name",
  "short_name",
  "slug",
  "event_type",
  "start_date",
  "end_date",
  "venue_name",
  "city",
  "state",
  "country",
  "status",
  "registration_open",
  "website_url",
  "brochure_url",
  "tagline",
  "logo_url",
  "banner_url",
  "total_delegates",
].join(", ")

export async function GET() {
  try {
    const supabase = createAdminClient()

    // is_public is the legacy "show on public surfaces" flag that the
    // eventz360 admin actually maintains; `visibility` is set to
    // "private" on every current row even when the event is meant to
    // be public, so filtering on that column would return zero results.
    // The test/demo exclusions catch the obvious staging rows.
    const todayIso = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from("events")
      .select(SAFE_FIELDS)
      .eq("is_public", true)
      .gte("end_date", todayIso)
      .not("status", "in", "(archived,cancelled,completed,draft)")
      .not("name", "ilike", "%test%")
      .not("name", "ilike", "%demo%")
      .not("short_name", "ilike", "%test%")
      .not("short_name", "ilike", "%demo%")
      .order("start_date", { ascending: true })
      .throwOnError()

    return NextResponse.json({ status: true, events: data ?? [] })
  } catch (error: unknown) {
    console.error("events list failed:", error)
    Sentry.captureException(error, { tags: { flow: "events_list" } })
    return NextResponse.json(
      { status: false, message: "Failed to load events", events: [] },
      { status: 500 }
    )
  }
}
