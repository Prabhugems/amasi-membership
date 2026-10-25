// @auth: public — survey participant link from email; the token in the URL is
// the credential (only its sha256 is stored) and opens exactly one
// survey_participant_details row. IP rate-limited; POST is same-origin only.
import { NextRequest, NextResponse } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { parseSurveyDetails, surveyTokenHash, type SurveyParticipantView } from "@/lib/survey"

type Params = { params: Promise<{ token: string }> }

const INVALID = "This link is not valid. Please use the link in your email."

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store")
  res.headers.set("Referrer-Policy", "no-referrer")
  return res
}

const invalid = () => noStore(NextResponse.json({ error: INVALID }, { status: 404 }))
const tooMany = () => noStore(NextResponse.json({ error: "Too many tries. Please wait a few minutes." }, { status: 429 }))

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
}

/** GET /api/survey/[token] — this link's own row: email, surveys and the details we hold. Never the id or the hash. */
export async function GET(request: NextRequest, { params }: Params) {
  const rl = await checkRateLimit(`survey-view:${clientIp(request)}`, 60, 15 * 60 * 1000)
  if (!rl.allowed) return tooMany()
  const hash = surveyTokenHash((await params).token)
  if (!hash) return invalid()
  try {
    const { data, error } = await createAdminClient()
      .from("survey_participant_details")
      .select("email, surveys, name, hospital, city, submitted_at")
      .eq("token_hash", hash)
      .maybeSingle()
    if (error) throw error
    if (!data) return invalid()
    const participant: SurveyParticipantView = {
      email: data.email,
      surveys: data.surveys ?? [],
      name: data.name ?? "",
      hospital: data.hospital ?? "",
      city: data.city ?? "",
      submitted: !!data.submitted_at,
    }
    return noStore(NextResponse.json({ participant }))
  } catch (e) {
    Sentry.captureException(e, { tags: { route: "survey/[token]" } })
    return noStore(NextResponse.json({ error: "Could not load this page. Try again in a moment." }, { status: 500 }))
  }
}

/** POST /api/survey/[token] — save the name on this link's row. Sending again overwrites. */
export async function POST(request: NextRequest, { params }: Params) {
  const origin = request.headers.get("origin")
  if (!origin || origin !== new URL(request.url).origin) {
    return noStore(NextResponse.json({ error: "Invalid request" }, { status: 403 }))
  }
  const rl = await checkRateLimit(`survey-save:${clientIp(request)}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) return tooMany()
  const hash = surveyTokenHash((await params).token)
  if (!hash) return invalid()
  const parsed = parseSurveyDetails(await request.json().catch(() => null))
  if (!parsed.ok) return noStore(NextResponse.json({ error: parsed.error }, { status: 400 }))
  try {
    const now = new Date().toISOString()
    const { data, error } = await createAdminClient()
      .from("survey_participant_details")
      .update({ ...parsed.value, submitted_at: now, updated_at: now })
      .eq("token_hash", hash)
      .select("id")
    if (error) throw error
    if (!data?.length) return invalid()
    return noStore(NextResponse.json({ ok: true }))
  } catch (e) {
    Sentry.captureException(e, { tags: { route: "survey/[token]" } })
    return noStore(NextResponse.json({ error: "That did not save. Try again in a moment." }, { status: 500 }))
  }
}
