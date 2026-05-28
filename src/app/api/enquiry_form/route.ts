// @auth: public — legacy mobile shim. The Flutter "Contact Us" / enquiry
// form (called from the Know-application screen) posts `first_name`,
// `last_name`, `email_id`, `mobile_number`, `member_no`, `subject`,
// `message`. The legacy backend wrote to tbl_enquiry_form; we land it in
// `support_tickets` so it shows up in the same admin queue real tickets
// use, with category = "general_enquiry" so the routing rules can target
// (or not) the mobile-app channel.
//
// See migration/SHIM_README.md and migration/flutter-usage.md row 12.

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
    const rl = await checkRateLimit(`shim-enquiry:${ip}`, 5, 15 * 60 * 1000)
    if (!rl.allowed) {
      return legacyErr("Too many submissions. Please try again later.")
    }

    const form = await parseLegacyForm(request)
    const firstName = field(form, "first_name").trim()
    const lastName = field(form, "last_name").trim()
    const email = field(form, "email_id").toLowerCase().trim()
    const mobile = field(form, "mobile_number").trim()
    const memberNo = field(form, "member_no").trim()
    const subject = field(form, "subject").trim()
    const message = field(form, "message").trim()

    if (!email || !subject || !message) {
      return legacyErr("Email, subject and message are required")
    }

    const fullName = [firstName, lastName].filter(Boolean).join(" ") || "Mobile App User"

    const supabase = createAdminClient()

    const { error } = await supabase.from("support_tickets").insert({
      ticket_number: generateTicketNumber(),
      name: fullName,
      email,
      phone: mobile || null,
      amasi_number: memberNo ? parseInt(memberNo, 10) || null : null,
      category: "general_enquiry",
      subject,
      description: message,
      status: "open",
      priority: "normal",
      sla_due_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    })

    if (error) {
      Sentry.captureException(error, {
        tags: { route: "shim/enquiry_form", phase: "ticket-insert" },
      })
      return legacyErr("Failed to submit enquiry")
    }

    return legacyOk("Enquiry submitted successfully")
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "shim/enquiry_form" } })
    return legacyErr("Something went wrong")
  }
}

export const GET = POST
