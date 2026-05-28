// @auth: public — legacy mobile shim. The Flutter "Send Details to My
// Email" button on the Know-application details screen posts `id` (the
// application id captured from /api/know_membership), and the legacy
// backend emailed a summary of the member/application to the row's email.
//
// We accept `id` as either a `membership_applications.id` (the legacy
// shape that know_membership returns) or a `members.id` (a defensive
// allowance for any other caller). Whichever we find, we email the
// resolved record's email with the member's name, AMASI number, status,
// and ref number.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 14.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"
import { escapeHtml } from "@/lib/html-escape"

type Summary = {
  toEmail: string
  fullName: string
  amasiNumber: number | null
  applicationNo: string | null
  status: string | null
}

async function buildSummary(
  supabase: ReturnType<typeof createAdminClient>,
  id: string,
): Promise<{ summary: Summary | null; error: string | null }> {
  // Try application first (the legacy id shape from know_membership).
  const { data: app, error: appErr } = await supabase
    .from("membership_applications")
    .select(
      "id, reference_number, email, first_name, middle_name, last_name, salutation, status, assigned_amasi_number"
    )
    .eq("id", id)
    .limit(1)
    .maybeSingle()
  if (appErr) return { summary: null, error: appErr.message }

  if (app) {
    return {
      summary: {
        toEmail: app.email ?? "",
        fullName: [app.salutation, app.first_name, app.middle_name, app.last_name]
          .filter((p) => typeof p === "string" && p.length)
          .join(" "),
        amasiNumber: app.assigned_amasi_number ?? null,
        applicationNo: app.reference_number ?? null,
        status: app.status ?? null,
      },
      error: null,
    }
  }

  // Fallback: treat id as a member UUID.
  const { data: member, error: memberErr } = await supabase
    .from("members")
    .select("id, email, first_name, middle_name, last_name, salutation, amasi_number, application_no, status")
    .eq("id", id)
    .limit(1)
    .maybeSingle()
  if (memberErr) return { summary: null, error: memberErr.message }
  if (!member) return { summary: null, error: null }

  return {
    summary: {
      toEmail: member.email ?? "",
      fullName: [member.salutation, member.first_name, member.middle_name, member.last_name]
        .filter((p) => typeof p === "string" && p.length)
        .join(" "),
      amasiNumber: member.amasi_number ?? null,
      applicationNo: member.application_no ?? null,
      status: member.status ?? null,
    },
    error: null,
  }
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-send-details:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many requests. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const id = field(form, "id").trim()
    if (!id) return legacyErr("Id is required")

    const supabase = createAdminClient()
    const { summary, error: lookupErr } = await buildSummary(supabase, id)

    if (lookupErr) {
      Sentry.captureException(new Error(lookupErr), {
        tags: { route: "shim/send_details_toMail", phase: "lookup" },
      })
      return legacyErr("Something went wrong")
    }

    if (!summary || !summary.toEmail) {
      return legacyErr("No record found for the given id")
    }

    const key = process.env.RESEND_API_KEY?.trim()
    if (!key) {
      Sentry.captureMessage("RESEND_API_KEY not configured for send_details_toMail")
      return legacyErr("Email service not configured")
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a; margin-bottom: 16px;">Your AMASI Membership Details</h2>
        <p style="color: #555; font-size: 15px; line-height: 1.55;">
          Hi ${escapeHtml(summary.fullName || "Member")},
        </p>
        <p style="color: #555; font-size: 15px; line-height: 1.55;">
          As requested from the AMASI mobile app, here are the details on file for your record:
        </p>
        <table style="border-collapse: collapse; margin: 16px 0; font-size: 14px; color: #1a1a1a;">
          <tr><td style="padding: 6px 12px 6px 0; color: #777;">Name</td><td style="padding: 6px 0;">${escapeHtml(summary.fullName || "—")}</td></tr>
          <tr><td style="padding: 6px 12px 6px 0; color: #777;">AMASI Number</td><td style="padding: 6px 0;">${summary.amasiNumber ?? "—"}</td></tr>
          <tr><td style="padding: 6px 12px 6px 0; color: #777;">Application Number</td><td style="padding: 6px 0;">${escapeHtml(summary.applicationNo ?? "—")}</td></tr>
          <tr><td style="padding: 6px 12px 6px 0; color: #777;">Status</td><td style="padding: 6px 0;">${escapeHtml(summary.status ?? "—")}</td></tr>
        </table>
        <p style="color: #777; font-size: 13px; line-height: 1.55; margin-top: 24px;">
          If you didn't request this, you can safely ignore the email.
        </p>
      </div>
    `

    const { Resend } = await import("resend")
    const resend = new Resend(key)
    const { error: sendErr } = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: summary.toEmail,
      subject: "Your AMASI Membership Details",
      html,
    })

    if (sendErr) {
      Sentry.captureException(sendErr, {
        tags: { route: "shim/send_details_toMail", op: "email_send" },
      })
      return legacyErr("Failed to send email")
    }

    return legacyOk("Details sent to your registered email address")
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/send_details_toMail" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST
