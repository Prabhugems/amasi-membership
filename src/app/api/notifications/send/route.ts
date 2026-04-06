import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { sendTemplate } from "@/lib/whatsapp"
import { Resend } from "resend"

const MAX_BATCH = 500

function buildEmailHtml(name: string, body: string) {
  return `<div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
  <div style="text-align: center; margin-bottom: 24px;">
    <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
    <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
  </div>
  <p style="color: #555;">Dear ${name},</p>
  <div style="color: #333; line-height: 1.6; white-space: pre-wrap;">${body}</div>
  <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
  <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
</div>`
}

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { type, filter, subject, message, template } = body

    if (!type || !["email", "whatsapp", "both"].includes(type)) {
      return Response.json({ status: false, message: "Invalid notification type" }, { status: 400 })
    }

    if ((type === "email" || type === "both") && (!subject || !message)) {
      return Response.json({ status: false, message: "Subject and message required for email" }, { status: 400 })
    }

    if ((type === "whatsapp" || type === "both") && !template) {
      return Response.json({ status: false, message: "Template required for WhatsApp" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Build query based on filters
    let query = supabase
      .from("members")
      .select("id, name, email, phone, membership_type, state, zone")

    if (filter) {
      if (filter.membershipType && filter.membershipType.length > 0) {
        query = query.in("membership_type", filter.membershipType)
      }
      if (filter.state) {
        query = query.eq("state", filter.state)
      }
      if (filter.zone) {
        query = query.eq("zone", filter.zone)
      }
      if (filter.hasIncompleteProfile) {
        query = query.or(
          "pg_degree.is.null,mci_council_number.is.null,date_of_birth.is.null,gender.is.null"
        )
      }
    }

    // Fetch members in batches to handle large datasets
    const members: any[] = []
    let offset = 0
    const batchSize = 1000
    while (true) {
      const { data: batch, error } = await query.range(offset, offset + batchSize - 1)
      if (error) {
        return Response.json({ status: false, message: error.message }, { status: 500 })
      }
      if (!batch || batch.length === 0) break
      members.push(...batch)
      if (batch.length < batchSize) break
      offset += batchSize
    }

    // If custom emails provided, filter or add
    if (filter?.customEmails && filter.customEmails.length > 0) {
      const customList = filter.customEmails
        .split(",")
        .map((e: string) => e.trim().toLowerCase())
        .filter(Boolean)

      // If no other filters set, fetch members by these emails
      if (
        !filter.membershipType?.length &&
        !filter.state &&
        !filter.zone &&
        !filter.hasIncompleteProfile
      ) {
        members.length = 0
        for (let i = 0; i < customList.length; i += 50) {
          const chunk = customList.slice(i, i + 50)
          const { data } = await supabase
            .from("members")
            .select("id, name, email, phone, membership_type, state, zone")
            .in("email", chunk)
          if (data) members.push(...data)
        }
      }
    }

    if (members.length === 0) {
      return Response.json({ status: false, message: "No members match the filters" }, { status: 400 })
    }

    // Rate limit: cap at MAX_BATCH
    const targetMembers = members.slice(0, MAX_BATCH)
    const total = targetMembers.length

    let sent = 0
    let failed = 0

    // Send emails
    if (type === "email" || type === "both") {
      const resend = getResend()
      const fromEmail = process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>"

      const emailMembers = targetMembers.filter((m) => m.email)

      // Resend batch supports up to 100 per call
      for (let i = 0; i < emailMembers.length; i += 100) {
        const chunk = emailMembers.slice(i, i + 100)
        const emails = chunk.map((m) => ({
          from: fromEmail,
          to: m.email,
          subject: subject,
          html: buildEmailHtml(m.name || "Member", message),
        }))

        try {
          const result = await resend.batch.send(emails)
          if (result.data) {
            sent += chunk.length
          } else {
            failed += chunk.length
          }
        } catch (err) {
          console.error("[Notifications] Email batch error:", err)
          failed += chunk.length
        }
      }

      // Count members without email as failed
      const noEmail = targetMembers.filter((m) => !m.email).length
      if (type === "email") failed += noEmail
    }

    // Send WhatsApp
    if (type === "whatsapp" || type === "both") {
      const waMembers = targetMembers.filter((m) => m.phone)

      for (const m of waMembers) {
        const result = await sendTemplate(
          m.phone,
          m.name || "Member",
          template,
          { Name: m.name || "Member" }
        )
        if (result.success) {
          sent++
        } else {
          failed++
        }
      }

      const noPhone = targetMembers.filter((m) => !m.phone).length
      if (type === "whatsapp") failed += noPhone
    }

    // Log the notification
    await supabase.from("notification_logs").insert({
      type,
      subject: subject || null,
      message: message || template || null,
      filters: filter || {},
      sent_count: sent,
      failed_count: failed,
      total_count: total,
      sent_by: (session.email as string) || "admin",
    })

    return Response.json({
      status: true,
      sent,
      failed,
      total,
      message: `Notification sent to ${sent} of ${total} members`,
    })
  } catch (error: any) {
    console.error("Notification send error:", error)
    return Response.json(
      { status: false, message: error.message || "Failed to send notifications" },
      { status: 500 }
    )
  }
}
