// @auth: public — any member may file an objection to a roll entry without a
// member session (objector identity collected in the body). Rate-limited by
// IP+email composite.
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

// Where new-objection alerts go. Confirmed with Prabhu 2026-05-21.
const ELECTION_OFFICER_EMAIL = "amasi.india@gmail.com"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

const TYPE_LABEL: Record<string, string> = {
  incorrect_details: "Incorrect details on the roll",
  should_be_removed: "Should be removed from the roll",
  should_be_added: "Missing from the roll — should be added",
  other: "Other",
}

type ObjectionType = "incorrect_details" | "should_be_removed" | "should_be_added" | "other"
const VALID_TYPES: ReadonlySet<string> = new Set([
  "incorrect_details",
  "should_be_removed",
  "should_be_added",
  "other",
])

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return Response.json({ status: false, message: "Invalid request body" }, { status: 400 })
  }

  const objectorEmail = typeof body.objector_email === "string" ? body.objector_email.trim().toLowerCase() : ""
  const objectorName = typeof body.objector_name === "string" ? body.objector_name.trim() : ""
  const objectorPhone = typeof body.objector_phone === "string" ? body.objector_phone.trim() : ""
  const objectorRelation = typeof body.objector_relation === "string" ? body.objector_relation.trim() : ""
  const objectionText = typeof body.objection_text === "string" ? body.objection_text.trim() : ""
  const objectionType = typeof body.objection_type === "string" ? body.objection_type : ""
  const targetRaw = body.target_amasi_number
  const targetAmasiNumber =
    typeof targetRaw === "number" && Number.isInteger(targetRaw)
      ? targetRaw
      : typeof targetRaw === "string" && /^\d+$/.test(targetRaw.trim())
        ? parseInt(targetRaw.trim(), 10)
        : null

  if (!objectorName || objectorName.length > 200) {
    return Response.json({ status: false, message: "Your name is required" }, { status: 400 })
  }
  if (!objectorEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(objectorEmail) || objectorEmail.length > 254) {
    return Response.json({ status: false, message: "A valid email address is required" }, { status: 400 })
  }
  if (objectorPhone && !/^\+?[\d\s-]{6,20}$/.test(objectorPhone)) {
    return Response.json({ status: false, message: "Phone number format is invalid" }, { status: 400 })
  }
  if (!VALID_TYPES.has(objectionType)) {
    return Response.json({ status: false, message: "Please choose an objection type" }, { status: 400 })
  }
  if (!objectionText || objectionText.length < 10 || objectionText.length > 4000) {
    return Response.json(
      { status: false, message: "Please describe your objection in 10 to 4000 characters" },
      { status: 400 }
    )
  }
  if (objectionType !== "should_be_added" && !targetAmasiNumber) {
    return Response.json(
      { status: false, message: "Please specify the AMASI number you are objecting to" },
      { status: 400 }
    )
  }

  const rl = await checkRateLimit(`electoral-objection:${ip}:${objectorEmail}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "You have submitted too many objections recently. Please wait an hour before filing another." },
      { status: 429 }
    )
  }

  try {
    const supabase = createAdminClient()
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null

    const { data, error } = await supabase
      .from("electoral_objections")
      .insert({
        target_amasi_number: targetAmasiNumber,
        objection_type: objectionType as ObjectionType,
        objection_text: objectionText,
        objector_name: objectorName,
        objector_email: objectorEmail,
        objector_phone: objectorPhone || null,
        objector_relation: objectorRelation || null,
        ip,
        user_agent: userAgent,
      })
      .select("id")
      .single()

    if (error || !data) {
      console.error("Electoral objection insert error:", error)
      return Response.json(
        { status: false, message: "Failed to record objection. Please try again or email amasi.india@gmail.com." },
        { status: 500 }
      )
    }

    // Notify the Election Officer. Wrapped in try/catch so a Resend outage
    // does not roll back the objection (the row is already in the DB and
    // visible in /admin/electoral-roll).
    try {
      const resend = getResend()
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"
      const adminLink = `${appUrl}/admin/electoral-roll`
      const targetLine = targetAmasiNumber
        ? `<p style="margin:4px 0;"><strong>Re: AMASI #</strong> ${targetAmasiNumber}</p>`
        : ""
      const phoneLine = objectorPhone
        ? `<p style="margin:4px 0;"><strong>Phone:</strong> ${escapeHtml(objectorPhone)}</p>`
        : ""
      const relationLine = objectorRelation
        ? `<p style="margin:4px 0;"><strong>Relation:</strong> ${escapeHtml(objectorRelation)}</p>`
        : ""

      const sendResult = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: ELECTION_OFFICER_EMAIL,
        replyTo: objectorEmail,
        subject: `New electoral-roll objection — ${TYPE_LABEL[objectionType] || objectionType}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <h2 style="color:#1a1a1a; margin:0 0 4px;">New objection filed</h2>
            <p style="color:#888; margin:0 0 16px; font-size:13px;">Provisional Electoral Roll 2026</p>

            <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:16px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>Type:</strong> ${escapeHtml(TYPE_LABEL[objectionType] || objectionType)}</p>
              ${targetLine}
              <p style="margin:8px 0 4px;"><strong>Details:</strong></p>
              <p style="margin:0; white-space:pre-wrap; color:#374151;">${escapeHtml(objectionText)}</p>
            </div>

            <div style="background:#f9fafb; border:1px solid #e5e7eb; border-radius:8px; padding:16px; margin:16px 0;">
              <p style="margin:4px 0;"><strong>From:</strong> ${escapeHtml(objectorName)}</p>
              <p style="margin:4px 0;"><strong>Email:</strong> <a href="mailto:${escapeHtml(objectorEmail)}" style="color:#2563eb;">${escapeHtml(objectorEmail)}</a></p>
              ${phoneLine}
              ${relationLine}
              <p style="margin:8px 0 0; color:#6b7280; font-size:12px;">Replying to this email will reach the objector directly.</p>
            </div>

            <p style="text-align:center; margin:24px 0;">
              <a href="${adminLink}" style="display:inline-block; background:#2563eb; color:#fff; text-decoration:none; padding:12px 24px; border-radius:6px; font-weight:bold;">Open admin triage</a>
            </p>

            <hr style="border:none; border-top:1px solid #e5e7eb; margin:24px 0;" />
            <p style="color:#999; font-size:12px; text-align:center;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })

      // Resend returns errors in the response body, not by throwing. Surface
      // them the same way we surface a thrown exception — otherwise an
      // unverified-domain / invalid-key failure looks like success in the log.
      if (sendResult.error) {
        console.error("Electoral objection notify-email Resend error:", sendResult.error)
        const Sentry = await import("@sentry/nextjs")
        Sentry.captureMessage("Electoral objection notify-email failed (Resend response.error)", {
          level: "error",
          tags: { route: "electoral-objection", op: "notify-email" },
          extra: { objectionId: data.id, error: sendResult.error },
        })
      } else {
        console.log("[electoral-objection] notify-email sent:", sendResult.data?.id)
      }
    } catch (emailErr) {
      // Surface in Sentry but never fail the request — the objection is
      // already saved and the admin can still pick it up from /admin/electoral-roll.
      console.error("Electoral objection notify-email failed:", emailErr)
      const Sentry = await import("@sentry/nextjs")
      Sentry.captureException(emailErr, {
        tags: { route: "electoral-objection", op: "notify-email" },
        extra: { objectionId: data.id },
      })
    }

    return Response.json({
      status: true,
      message: "Your objection has been recorded. The election officer will be in touch.",
      id: data.id,
    })
  } catch (error: unknown) {
    console.error("Electoral objection error:", error)
    return Response.json(
      { status: false, message: "Failed to record objection. Please try again." },
      { status: 500 }
    )
  }
}
