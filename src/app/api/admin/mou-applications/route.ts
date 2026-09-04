// @auth: admin
import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { listApplications } from "@/lib/mou/supabase-helpers"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// Same spirit as admin/orphan-payments/route.ts's clampInt — an admin-only
// endpoint still shouldn't trust its own query params to be well-formed.
// Without this, ?limit=999999999 (or a non-numeric value) reaches
// listApplications' .range() unclamped.
function parseLimit(value: string | null): number {
  const n = value === null ? NaN : Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

function parseOffset(value: string | null): number {
  const n = value === null ? NaN : Number.parseInt(value, 10)
  if (!Number.isFinite(n) || n < 0) return 0
  return n
}

export async function GET(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })

  const type = request.nextUrl.searchParams.get("type") ?? undefined
  const status = request.nextUrl.searchParams.get("status") ?? undefined
  const limit = parseLimit(request.nextUrl.searchParams.get("limit"))
  const offset = parseOffset(request.nextUrl.searchParams.get("offset"))

  const result = await listApplications({ type, status, limit, offset })
  return Response.json({ status: true, ...result })
}
