// @auth: public — legacy mobile shim. ACM→LM conversion in the Flutter
// binary is a multi-field intake (member_id + ASI membership data) that
// the legacy backend processed inline. The new portal's /api/members/upgrade
// route does the conversion properly but requires a file upload (ASI
// certificate), OCR verification, and an authenticated member session —
// none of which the Flutter call site forwards.
//
// Bridge: capture the request as a support ticket so admin can drive the
// upgrade manually via the web UI. Far better than a "feature updating"
// stub since the user actually gets a paper trail and a response time
// commitment via the SLA on the ticket.
//
// See migration/SHIM_README.md.

import type { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import { legacyOk, legacyErr, parseLegacyForm, field } from "@/lib/mobile-shim"

function generateTicketNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let code = ""
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `TKT-${date}-${code}`
}

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`shim-conversion:${ip}`, 3, 60 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many requests. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const memberId = field(form, "id").trim() || field(form, "member_id").trim()
    const asiNumber = field(form, "asi_membership_no").trim()
    const asiState = field(form, "asi_state").trim()

    if (!memberId) return legacyErr("Member id is required")

    const supabase = createAdminClient()

    // Resolve the member to fill the ticket with identifying info.
    const { data: member } = await supabase
      .from("members")
      .select("id, email, first_name, last_name, phone, amasi_number, membership_type")
      .eq("id", memberId)
      .limit(1)
      .maybeSingle()

    const name = member
      ? [member.first_name, member.last_name].filter(Boolean).join(" ") || "Mobile member"
      : "Mobile member (unresolved id)"
    const email = member?.email ?? "(no email on file)"
    const phoneStr = member?.phone != null ? String(member.phone) : null

    const description = [
      "Membership upgrade requested via mobile app.",
      `Current membership type: ${member?.membership_type ?? "unknown"}`,
      `ASI Membership Number: ${asiNumber || "(not supplied)"}`,
      `ASI State: ${asiState || "(not supplied)"}`,
      "",
      "Admin: please collect the ASI certificate from the member and process the conversion via the web upgrade flow at membership.amasi.org.",
    ].join("\n")

    const { error: insertErr } = await supabase.from("support_tickets").insert({
      ticket_number: generateTicketNumber(),
      name,
      email,
      phone: phoneStr,
      amasi_number: member?.amasi_number ?? null,
      category: "membership_upgrade",
      subject: "ACM → LM upgrade request (mobile app)",
      description,
      status: "open",
      priority: "normal",
      sla_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })

    if (insertErr) {
      Sentry.captureException(insertErr, {
        tags: { route: "shim/member_conversion", phase: "ticket-insert" },
      })
      return legacyErr("Failed to submit upgrade request")
    }

    return legacyOk(
      "Upgrade request submitted. Our team will contact you within 1 working day."
    )
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/member_conversion" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST
