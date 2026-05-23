// @auth: public — historical FMAS/MMAS course registry; no PII, anonymous by design.
import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"

// Public, anonymous read endpoint for the mobile CME / Courses screen.
//
// Source of truth is `public.skill_courses` — the same historical
// registry the FMAS credential endpoint joins against. Every row today
// is `credential_type = 'FMAS'`; the table has no MMAS rows yet, so a
// `?type=MMAS` query returns an empty list (intentional — the client
// renders an empty state). `?type=all` (or omitted) returns everything.
//
// The table is read-only history (year + place + convenor + venue);
// there is no Apply / register URL field, so the mobile UI hides the
// CTA when none is present.

const VALID_TYPES = ["FMAS", "MMAS"] as const
type CourseType = (typeof VALID_TYPES)[number]

export async function GET(request: NextRequest) {
  try {
    const rawType = request.nextUrl.searchParams.get("type")?.toUpperCase() ?? null
    const filterType =
      rawType && VALID_TYPES.includes(rawType as CourseType)
        ? (rawType as CourseType)
        : null

    const supabase = createAdminClient()
    let q = supabase
      .from("skill_courses")
      .select("id, credential_type, name, place, year, convenor, venue")
      .order("year", { ascending: false })
      .order("id", { ascending: false })

    if (filterType) {
      q = q.eq("credential_type", filterType)
    }

    const { data } = await q.throwOnError()
    return NextResponse.json({ status: true, courses: data ?? [] })
  } catch (error: unknown) {
    console.error("courses list failed:", error)
    Sentry.captureException(error, { tags: { flow: "courses_list" } })
    return NextResponse.json(
      { status: false, message: "Failed to load courses", courses: [] },
      { status: 500 }
    )
  }
}
