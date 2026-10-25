import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { hasAllDetails, isSurveyCode, surveyCsv, type SurveyAdminRow } from "@/lib/survey"

const PAGE = 1000

/**
 * GET /api/admin/survey — every survey participant, with and without details.
 *   ?survey=DLC|PVH        only that survey's participants
 *   ?status=with|without   only rows with (or missing) name, hospital and city
 *   ?format=csv            download instead of JSON
 */
export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { searchParams } = request.nextUrl
  const survey = searchParams.get("survey") || ""
  const status = searchParams.get("status") || ""
  if (survey && !isSurveyCode(survey)) return NextResponse.json({ error: "Unknown survey" }, { status: 400 })
  if (status && status !== "with" && status !== "without") {
    return NextResponse.json({ error: "Unknown status" }, { status: 400 })
  }

  try {
    const supabase = createAdminClient()
    let rows: SurveyAdminRow[] = []
    for (let offset = 0; ; offset += PAGE) {
      let query = supabase
        .from("survey_participant_details")
        .select("email, surveys, name, hospital, city, submitted_at, emailed_at")
        .order("email", { ascending: true })
      if (survey) query = query.contains("surveys", [survey])
      const { data, error } = await query.range(offset, offset + PAGE - 1)
      if (error) throw error
      // Copy named fields only, so the token hash can never ride along.
      rows = rows.concat(
        ((data ?? []) as SurveyAdminRow[]).map(({ email, surveys, name, hospital, city, submitted_at, emailed_at }) => ({
          email,
          surveys: surveys ?? [],
          name,
          hospital,
          city,
          submitted_at,
          emailed_at,
        }))
      )
      if (!data || data.length < PAGE) break
    }
    if (status) rows = rows.filter((r) => hasAllDetails(r) === (status === "with"))

    if (searchParams.get("format") === "csv") {
      const name = `survey-participants${survey ? `-${survey}` : ""}${status ? `-${status}-details` : ""}.csv`
      return new NextResponse(surveyCsv(rows), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${name}"`,
          "Cache-Control": "no-store",
        },
      })
    }
    const res = NextResponse.json({ rows })
    res.headers.set("Cache-Control", "no-store")
    return res
  } catch (e) {
    Sentry.captureException(e, { tags: { route: "admin/survey" } })
    return NextResponse.json({ error: "Could not load survey participants" }, { status: 500 })
  }
}
