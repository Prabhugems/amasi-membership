import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { getMemberSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"

// POST /api/push/register — register or refresh an Expo push token for the
// authenticated member. Used by amasi-mobile on app start and on Expo
// token-rotation. Idempotent via upsert on (member_id, expo_push_token).
//
// Auth chain mirrors /api/member/me:
//   - No / invalid JWT                                   → 401
//   - JWT valid, no member row matches session.email     → 403 MEMBER_NOT_FOUND
//   - Member exists, status !== 'active'                 → 403 MEMBERSHIP_INACTIVE
//   - Active member, valid body                          → 200

const EXPO_TOKEN_REGEX = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/
const MAX_TOKEN_LEN = 256
const MAX_APP_VERSION_LEN = 32

type RegisterBody = {
  expo_push_token: string
  platform: "ios" | "android"
  app_version: string | null
}

function validate(raw: unknown): RegisterBody | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid request body" }
  const body = raw as Record<string, unknown>

  const tokenRaw = body.expo_push_token
  if (typeof tokenRaw !== "string") return { error: "Invalid expo_push_token" }
  const expo_push_token = tokenRaw.trim()
  if (
    !expo_push_token ||
    expo_push_token.length > MAX_TOKEN_LEN ||
    !EXPO_TOKEN_REGEX.test(expo_push_token)
  ) {
    return { error: "Invalid expo_push_token" }
  }

  if (body.platform !== "ios" && body.platform !== "android") {
    return { error: "Invalid platform" }
  }

  let app_version: string | null = null
  if (body.app_version !== undefined && body.app_version !== null) {
    if (typeof body.app_version !== "string") {
      return { error: "Invalid app_version" }
    }
    const trimmed = body.app_version.trim()
    if (trimmed.length > MAX_APP_VERSION_LEN) {
      return { error: "Invalid app_version" }
    }
    app_version = trimmed || null
  }

  return { expo_push_token, platform: body.platform, app_version }
}

export async function POST(request: NextRequest) {
  const session = await getMemberSession()
  if (!session?.email || typeof session.email !== "string") {
    return Response.json(
      { status: false, message: "Authentication required" },
      { status: 401 }
    )
  }

  let parsed: unknown
  try {
    parsed = await request.json()
  } catch {
    return Response.json(
      { status: false, message: "Invalid request body" },
      { status: 400 }
    )
  }

  const validated = validate(parsed)
  if ("error" in validated) {
    return Response.json(
      { status: false, message: validated.error },
      { status: 400 }
    )
  }

  const email = session.email.toLowerCase().trim()
  const supabase = createAdminClient()

  try {
    const { data: member, error: memberErr } = await supabase
      .from("members")
      .select("id, status")
      .ilike("email", email)
      .limit(1)
      .maybeSingle()

    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { route: "api/push/register", op: "member-lookup" },
      })
      return Response.json(
        { status: false, message: "Failed to register push token" },
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
          message:
            "Your membership is not active. Please contact AMASI office.",
        },
        { status: 403 }
      )
    }

    const { error: upsertErr } = await supabase.from("push_tokens").upsert(
      {
        member_id: member.id,
        expo_push_token: validated.expo_push_token,
        platform: validated.platform,
        app_version: validated.app_version,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "member_id,expo_push_token" }
    )

    if (upsertErr) {
      Sentry.captureException(upsertErr, {
        tags: { route: "api/push/register", op: "upsert" },
      })
      return Response.json(
        { status: false, message: "Failed to register push token" },
        { status: 500 }
      )
    }

    return Response.json({ status: true })
  } catch (e: unknown) {
    Sentry.captureException(e, { tags: { route: "api/push/register" } })
    return Response.json(
      { status: false, message: "Failed to register push token" },
      { status: 500 }
    )
  }
}
