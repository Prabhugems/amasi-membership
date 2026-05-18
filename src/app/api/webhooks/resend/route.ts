import { NextRequest } from "next/server"
import crypto from "crypto"
import { createAdminClient } from "@/lib/supabase"
import * as Sentry from "@sentry/nextjs"

const SVIX_TOLERANCE_SECONDS = 300 // 5 minutes

/**
 * Verify Resend's Svix-based webhook signature.
 * Signed content: `{svix-id}.{svix-timestamp}.{rawBody}`
 * Secret: base64-decoded `whsec_…` signing key from Resend dashboard.
 */
function verifyResendSignature(
  rawBody: string,
  msgId: string | null,
  msgTimestamp: string | null,
  msgSignature: string | null,
  secret: string,
): boolean {
  if (!msgId || !msgTimestamp || !msgSignature) return false

  const ts = parseInt(msgTimestamp, 10)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > SVIX_TOLERANCE_SECONDS) {
    return false
  }

  const rawSecret = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "base64")

  const signed = `${msgId}.${msgTimestamp}.${rawBody}`
  const hmac = crypto.createHmac("sha256", rawSecret).update(signed).digest("base64")

  // svix-signature is space-separated "v1,{base64sig}" tokens; match any
  return msgSignature.split(" ").some((token) => token.replace(/^v\d+,/, "") === hmac)
}

interface ResendEvent {
  type: string
  data: {
    email_id?: string
    from?: string
    to?: string[]
    subject?: string
    created_at?: string
    [key: string]: unknown
  }
}

export async function POST(request: NextRequest) {
  try {
    const signingSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET?.trim()
    if (!signingSecret) {
      console.error("[resend-webhook] RESEND_WEBHOOK_SIGNING_SECRET not configured")
      return Response.json({ error: "Server config error" }, { status: 500 })
    }

    const rawBody = await request.text()
    const msgId = request.headers.get("svix-id")
    const msgTimestamp = request.headers.get("svix-timestamp")
    const msgSignature = request.headers.get("svix-signature")

    if (!verifyResendSignature(rawBody, msgId, msgTimestamp, msgSignature, signingSecret)) {
      console.error("[resend-webhook] signature verification failed")
      return Response.json({ error: "Invalid signature" }, { status: 400 })
    }

    const event = JSON.parse(rawBody) as ResendEvent
    const { type, data } = event

    const HANDLED = ["email.delivered", "email.bounced", "email.complained"]
    if (!HANDLED.includes(type)) {
      return Response.json({ status: "ignored", event_type: type })
    }

    const recipientEmail = Array.isArray(data.to) && data.to[0] ? data.to[0] : null
    if (!recipientEmail) {
      return Response.json({ status: "ok", note: "no recipient" })
    }

    const normalizedEmail = recipientEmail.toLowerCase().trim()
    const supabase = createAdminClient()

    // Resolve draft and application rows by email (most recent first)
    const [draftRes, appRes] = await Promise.all([
      supabase
        .from("draft_applications")
        .select("id")
        .eq("email", normalizedEmail)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("membership_applications")
        .select("id")
        .eq("email", normalizedEmail)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

    const draftId = draftRes.data?.id ?? null
    const applicationId = appRes.data?.id ?? null

    const eventType =
      type === "email.delivered"
        ? "email_delivered"
        : type === "email.bounced"
          ? "email_bounced"
          : "email_complained"

    // throwOnError per CONTEXT.md — failed event writes must not be silently swallowed
    await supabase
      .from("application_step_events")
      .insert({
        email: normalizedEmail,
        draft_id: draftId,
        application_id: applicationId,
        event_type: eventType,
        step: null,
        status: type,
        metadata: {
          email_id: data.email_id ?? null,
          subject: data.subject ?? null,
          from: data.from ?? null,
          resend_event_type: type,
        },
      })
      .throwOnError()

    if (type === "email.bounced" || type === "email.complained") {
      Sentry.captureMessage(`[resend-webhook] ${type}: ${normalizedEmail}`, {
        level: type === "email.bounced" ? "warning" : "error",
        tags: { component: "resend-webhook", event_type: type },
        extra: {
          email: normalizedEmail,
          email_id: data.email_id,
          subject: data.subject,
          draft_id: draftId,
          application_id: applicationId,
        },
      })
    }

    console.log(
      `[resend-webhook] ${type} → ${normalizedEmail} (draft=${draftId ?? "none"}, app=${applicationId ?? "none"})`,
    )
    return Response.json({ status: "ok" })
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error("[resend-webhook] error:", msg)
    Sentry.captureException(error, { tags: { component: "resend-webhook" } })
    return Response.json({ error: "Webhook processing failed" }, { status: 500 })
  }
}
