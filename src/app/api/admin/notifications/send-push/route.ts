// @auth: admin — composes a push / in-app notification for a target
// audience. Always inserts into `member_notifications` (the in-app
// inbox); also fires FCM to bound `fcm_tokens` rows when FCM is
// configured. Returns per-member + per-token counts.
//
// Audience shapes supported in v1:
//   { kind: "all" }                                  — every active member
//   { kind: "amasi_numbers", value: [15632, 18460] } — explicit list
//   { kind: "membership_type", value: "LM" }         — by tier
//   { kind: "zone", value: "South Zone" }            — by zone label
//
// See sql/035_fcm_tokens.sql + sql/036_member_notifications.sql.

import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { sendFcmToTokens, isFcmConfigured } from "@/lib/fcm"
import { randomUUID } from "node:crypto"

type Audience =
  | { kind: "all" }
  | { kind: "amasi_numbers"; value: number[] }
  | { kind: "membership_type"; value: "LM" | "ALM" | "ACM" | "ILM" | string }
  | { kind: "zone"; value: string }

interface SendRequest {
  title: string
  body: string
  image_url?: string | null
  action_url?: string | null
  audience: Audience
  /** When true, skip FCM and only write to the in-app inbox. */
  in_app_only?: boolean
}

const MAX_RECIPIENTS = 20000 // hard ceiling — prevents an accidental "all" send to historical data

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
    }

    const body = (await request.json().catch(() => null)) as SendRequest | null
    if (!body || !body.title?.trim() || !body.body?.trim() || !body.audience?.kind) {
      return Response.json(
        { status: false, message: "title, body, audience.kind are required" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // 1. Resolve audience → list of member ids.
    let memberQuery = supabase
      .from("members")
      .select("id, amasi_number")
      .eq("status", "active")

    if (body.audience.kind === "amasi_numbers") {
      const nums = Array.isArray(body.audience.value) ? body.audience.value : []
      if (nums.length === 0) {
        return Response.json(
          { status: false, message: "audience.value must be a non-empty array of AMASI numbers" },
          { status: 400 }
        )
      }
      memberQuery = memberQuery.in("amasi_number", nums)
    } else if (body.audience.kind === "membership_type") {
      memberQuery = memberQuery.eq("membership_type", body.audience.value)
    } else if (body.audience.kind === "zone") {
      memberQuery = memberQuery.eq("zone", body.audience.value)
    } else if (body.audience.kind !== "all") {
      return Response.json(
        { status: false, message: `unknown audience.kind: ${String((body.audience as { kind: string }).kind)}` },
        { status: 400 }
      )
    }

    const { data: members, error: memberErr } = await memberQuery.limit(MAX_RECIPIENTS)
    if (memberErr) {
      Sentry.captureException(memberErr, {
        tags: { route: "admin/notifications/send-push", phase: "audience-resolve" },
      })
      return Response.json(
        { status: false, message: "Failed to resolve audience" },
        { status: 500 }
      )
    }

    const memberIds = (members ?? []).map((m) => m.id)
    if (memberIds.length === 0) {
      return Response.json(
        { status: false, message: "No active members match this audience" },
        { status: 400 }
      )
    }
    if (memberIds.length === MAX_RECIPIENTS) {
      Sentry.captureMessage(
        "send-push audience hit MAX_RECIPIENTS — partial send",
        { level: "warning" }
      )
    }

    // 2. Bulk insert into member_notifications, all under one broadcast_id.
    const broadcastId = randomUUID()
    // session.sub is the admin row id for DB-backed admins (UUID); for the
    // env-based default admin it's the literal "admin-1" string which won't
    // satisfy the admin_users FK. Only attribute when it's UUID-shaped.
    const adminSub = typeof session.sub === "string" ? session.sub : null
    const createdBy = adminSub && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adminSub) ? adminSub : null
    const rows = memberIds.map((id) => ({
      member_id: id,
      title: body.title.trim(),
      body: body.body.trim(),
      image_url: body.image_url?.trim() || null,
      action_url: body.action_url?.trim() || null,
      broadcast_id: broadcastId,
      created_by: createdBy,
    }))

    // Insert in chunks of 500 to stay under Supabase's payload ceilings.
    let inserted = 0
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500)
      const { error: insertErr, count } = await supabase
        .from("member_notifications")
        .insert(chunk, { count: "exact" })
      if (insertErr) {
        Sentry.captureException(insertErr, {
          tags: { route: "admin/notifications/send-push", phase: "insert", chunk_start: String(i) },
        })
        // Continue — partial success is still useful; we'll report the count.
      } else {
        inserted += count ?? chunk.length
      }
    }

    // 3. Resolve FCM tokens for those members + fire push (skipped when FCM not configured).
    let push = { attempted: 0, sent: 0, failed: 0, skipped: !isFcmConfigured() }
    if (!body.in_app_only && isFcmConfigured()) {
      const { data: tokenRows } = await supabase
        .from("fcm_tokens")
        .select("token")
        .in("member_id", memberIds)
      const tokens = (tokenRows ?? []).map((t) => t.token).filter(Boolean)
      const result = await sendFcmToTokens(tokens, {
        title: body.title.trim(),
        body: body.body.trim(),
        imageUrl: body.image_url,
        actionUrl: body.action_url,
        data: { broadcast_id: broadcastId },
      })
      push = {
        attempted: result.attempted,
        sent: result.sent,
        failed: result.failed,
        skipped: !!result.skipped,
      }

      // Mark delivered_at for the in-app rows whose member had at least one token
      // that we attempted to push to. (Not exact "FCM acked", but useful UX signal.)
      if (result.sent > 0) {
        const { data: deliveredMembers } = await supabase
          .from("fcm_tokens")
          .select("member_id")
          .in("member_id", memberIds)
          .not("member_id", "is", null)
        const memberIdsWithToken = Array.from(
          new Set((deliveredMembers ?? []).map((d) => d.member_id))
        ).filter(Boolean) as string[]
        if (memberIdsWithToken.length > 0) {
          await supabase
            .from("member_notifications")
            .update({ delivered_at: new Date().toISOString() })
            .eq("broadcast_id", broadcastId)
            .in("member_id", memberIdsWithToken)
        }
      }
    }

    return Response.json({
      status: true,
      broadcast_id: broadcastId,
      audience_count: memberIds.length,
      inbox_inserted: inserted,
      push,
    })
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "admin/notifications/send-push" },
    })
    return Response.json(
      { status: false, message: "Something went wrong" },
      { status: 500 }
    )
  }
}
