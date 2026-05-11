import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { getAuthenticatedMember } from "@/lib/auth"

// Unauthenticated callers see only public-safe fields — no email, phone,
// DOB, MCI number.
const PUBLIC_SELECT =
  "name, salutation, amasi_number, membership_type, pg_degree, city, state, zone, profile_photo"

// Authenticated active members additionally see email + mobile per AMASI
// President's directive (May 2026). Every authenticated query is logged to
// directory_access_log (see sql/030) so any later scraping incident can be
// traced back to the viewer.
//
// Schema note: members.phone is the actual column; we expose it as `mobile`
// in the response to match the naming used by /api/members/search and the
// /apply form field, which both call it `mobile`.
const MEMBER_SELECT = PUBLIC_SELECT + ", email, phone, mobile_code"

const UNAUTH_LIMIT_CAP = 50
const AUTH_LIMIT_CAP = 20

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`directory:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many requests. Please try again later.", data: [], count: 0 },
      { status: 429 }
    )
  }

  const supabase = createAdminClient()

  // Detect authenticated active member. Holding a valid member JWT is not
  // enough — the email on the JWT must still resolve to an active member
  // (status='active'). Anyone else falls through to the public field set.
  const { authenticated, member_id: viewerMemberId } = await getAuthenticatedMember(supabase)

  const searchParams = request.nextUrl.searchParams
  const q = searchParams.get("q")?.trim() || ""
  const state = searchParams.get("state")?.trim() || ""
  const zone = searchParams.get("zone")?.trim() || ""
  const type = searchParams.get("type")?.trim() || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
  const requestedLimit = parseInt(searchParams.get("limit") || "20") || 20
  // Authenticated requests return contact-bearing rows — keep the page small
  // to bound the blast radius of any single leak. Unauthenticated requests
  // keep the historical 50-row cap.
  const limitCap = authenticated ? AUTH_LIMIT_CAP : UNAUTH_LIMIT_CAP
  const limit = Math.min(limitCap, Math.max(1, requestedLimit))
  const offset = (page - 1) * limit

  try {
    let query = supabase
      .from("members")
      .select(authenticated ? MEMBER_SELECT : PUBLIC_SELECT, { count: "exact" })
      .eq("status", "active")

    // Text search across name, pg_degree, city
    if (q) {
      query = query.or(`name.ilike.%${q}%,pg_degree.ilike.%${q}%,city.ilike.%${q}%`)
    }

    if (state) {
      query = query.ilike("state", state)
    }

    if (zone) {
      query = query.ilike("zone", zone)
    }

    if (type) {
      query = query.eq("membership_type", type)
    }

    query = query.order("name", { ascending: true }).range(offset, offset + limit - 1)

    const { data, count, error } = await query

    if (error) {
      console.error("Directory query error:", error)
      return Response.json(
        { status: false, message: "Search failed", data: [], count: 0 },
        { status: 500 }
      )
    }

    // The shared types.d (src/types/database.types.ts) is a hand-authored stub
    // without per-table generics, so Supabase select() returns a generic
    // union with GenericStringError. Cast through unknown — this matches the
    // pattern used throughout the codebase until the schema is regenerated.
    const rows = (data || []) as unknown as Array<Record<string, unknown>>

    // Fire-and-forget audit log for authenticated queries. We never await this
    // — directory listing must not depend on the audit table being healthy,
    // and a slow/failed insert must not slow the response. The table is
    // additive (sql/030) and the column references members(id), so an
    // unresolved viewer_member_id would 23503 — we only insert when the
    // resolver confirmed an active member, so that can't happen here.
    if (authenticated && viewerMemberId) {
      void supabase
        .from("directory_access_log")
        .insert({
          viewer_member_id: viewerMemberId,
          query_params: { q, state, zone, type, page, limit },
          result_count: rows.length,
          ip,
        })
        .then(({ error: logError }) => {
          if (logError) {
            console.error("Directory audit log insert failed:", logError)
          }
        })
    }

    return Response.json({
      status: true,
      data: rows.map((m: Record<string, unknown>) => {
        const base = {
          name: m.name,
          salutation: m.salutation || "Dr.",
          amasi_number: m.amasi_number,
          membership_type: m.membership_type,
          pg_degree: m.pg_degree,
          city: m.city,
          state: m.state,
          zone: m.zone,
          profile_photo: m.profile_photo,
        }
        if (!authenticated) return base
        const phone: string = m.phone ? String(m.phone) : ""
        const code: string = m.mobile_code ? String(m.mobile_code) : ""
        const mobile = phone
          ? (code && !phone.startsWith("+") ? `${code} ${phone}` : phone)
          : null
        return {
          ...base,
          email: m.email || null,
          mobile,
        }
      }),
      count: count || 0,
      page,
      limit,
      totalPages: Math.ceil((count || 0) / limit),
    })
  } catch (error: unknown) {
    console.error("Directory error:", error)
    return Response.json(
      { status: false, message: "Search failed", data: [], count: 0 },
      { status: 500 }
    )
  }
}
