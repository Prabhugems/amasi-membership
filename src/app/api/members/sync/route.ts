import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getMemberSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"
import { createAdminClient } from "@/lib/supabase"

// GET /api/members/sync — bulk member sync for amasi-mobile offline cache.
// Per AMASI Mobile Tech Spec §5.1 and EC Decision C "Option B" field set.
//
// Query params:
//   - page          (optional, default 1)  integer >= 1
//   - updated_since (optional)              ISO timestamp; incremental delta
//
// Response:
//   { status, schema_version, members[], next_page | null, server_time }
//
// schema_version semantics: bumping = breaking client shape change.
// Old clients should refuse and prompt for app update. Currently 1.

const PAGE_SIZE = 500
const SCHEMA_VERSION = 1

const SYNC_SELECT =
  "amasi_number, name, salutation, profile_photo, membership_type, status," +
  " city, state, country, zone, pg_degree, email"

type MemberRow = {
  amasi_number: number
  name: string | null
  salutation: string | null
  profile_photo: string | null
  membership_type: string | null
  status: string
  city: string | null
  state: string | null
  country: string | null
  zone: string | null
  pg_degree: string | null
  email: string
}

export async function GET(request: NextRequest) {
  const session = await getMemberSession()
  if (!session?.email || typeof session.email !== "string") {
    return Response.json(
      { status: false, message: "Authentication required" },
      { status: 401 }
    )
  }

  const email = session.email.toLowerCase().trim()
  const supabase = createAdminClient()

  // Resolve member row in one round trip — distinguish MEMBER_NOT_FOUND
  // from MEMBERSHIP_INACTIVE for the mobile client. Same shape as
  // /api/member/me.
  const { data: member, error: memberErr } = await supabase
    .from("members")
    .select("id, status")
    .ilike("email", email)
    .limit(1)
    .maybeSingle()

  if (memberErr) {
    Sentry.captureException(memberErr, {
      tags: { route: "api/members/sync", op: "member-lookup" },
    })
    return Response.json(
      { status: false, message: "Failed to sync members" },
      { status: 500 }
    )
  }

  if (!member) {
    return Response.json(
      {
        status: false,
        code: "MEMBER_NOT_FOUND",
        message:
          "No member record found for this account. Please contact AMASI office.",
      },
      { status: 403 }
    )
  }

  if (member.status !== "active") {
    return Response.json(
      {
        status: false,
        code: "MEMBERSHIP_INACTIVE",
        message: "Your membership is not active. Please contact AMASI office.",
      },
      { status: 403 }
    )
  }

  const rl = await checkRateLimit(`sync:${member.id}`, 10, 60_000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many requests" },
      { status: 429 }
    )
  }

  const sp = request.nextUrl.searchParams

  const pageRaw = sp.get("page")
  const page = pageRaw === null ? 1 : Number.parseInt(pageRaw, 10)
  if (!Number.isFinite(page) || page < 1) {
    return Response.json(
      { status: false, message: "Invalid page" },
      { status: 400 }
    )
  }

  const updatedSinceRaw = sp.get("updated_since")
  let updatedSince: string | null = null
  if (updatedSinceRaw !== null) {
    const ts = new Date(updatedSinceRaw)
    if (Number.isNaN(ts.getTime())) {
      return Response.json(
        { status: false, message: "Invalid updated_since" },
        { status: 400 }
      )
    }
    updatedSince = ts.toISOString()
  }

  const offset = (page - 1) * PAGE_SIZE

  try {
    let q = supabase
      .from("members")
      .select(SYNC_SELECT)
      .eq("status", "active")
      .order("amasi_number", { ascending: true })
      // Fetch PAGE_SIZE+1 rows so we can detect "more pages exist" without
      // a count(*) round-trip. Slice to PAGE_SIZE before returning.
      .range(offset, offset + PAGE_SIZE)

    if (updatedSince) q = q.gt("updated_at", updatedSince)

    const { data, error } = await q
    if (error) {
      Sentry.captureException(error, {
        tags: { route: "api/members/sync", op: "query" },
      })
      return Response.json(
        { status: false, message: "Failed to sync members" },
        { status: 500 }
      )
    }

    const rows = (data ?? []) as unknown as MemberRow[]
    const hasMore = rows.length > PAGE_SIZE
    const slice = hasMore ? rows.slice(0, PAGE_SIZE) : rows

    const members = slice.map((r) => ({
      amasi_number: r.amasi_number,
      full_name: r.name ?? "",
      salutation: r.salutation ?? "",
      profile_photo: r.profile_photo,
      membership_type: r.membership_type ?? "",
      status: r.status,
      city: r.city ?? "",
      state: r.state ?? "",
      country: r.country ?? "",
      zone: r.zone ?? "",
      pg_degree: r.pg_degree ?? "",
      email: r.email,
    }))

    return Response.json({
      status: true,
      schema_version: SCHEMA_VERSION,
      members,
      next_page: hasMore ? page + 1 : null,
      server_time: new Date().toISOString(),
    })
  } catch (e: unknown) {
    Sentry.captureException(e, { tags: { route: "api/members/sync" } })
    return Response.json(
      { status: false, message: "Failed to sync members" },
      { status: 500 }
    )
  }
}
