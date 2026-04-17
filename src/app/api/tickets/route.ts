import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { Resend } from "resend"

function generateTicketNumber(): string {
  const now = new Date()
  const date = now.toISOString().slice(0, 10).replace(/-/g, "")
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
  let code = ""
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return `TKT-${date}-${code}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, email, phone, amasi_number, category, subject, description, priority, attachments } = body

    if (!name || !email || !category || !subject || !description) {
      return Response.json(
        { error: "Missing required fields: name, email, category, subject, description" },
        { status: 400 }
      )
    }

    const validPriorities = ["low", "normal", "high"]
    const resolvedPriority = validPriorities.includes(priority) ? priority : "normal"

    const supabase = createAdminClient()
    const ticket_number = generateTicketNumber()

    // Validate attachments if provided
    const validAttachments = Array.isArray(attachments)
      ? attachments.filter(
          (a: unknown) =>
            a &&
            typeof a === "object" &&
            typeof (a as Record<string, unknown>).url === "string" &&
            typeof (a as Record<string, unknown>).filename === "string"
        ).slice(0, 3)
      : []

    const { data, error } = await supabase
      .from("support_tickets")
      .insert({
        ticket_number,
        name,
        email,
        phone,
        amasi_number: amasi_number || null,
        category,
        subject,
        description,
        status: "open",
        priority: resolvedPriority,
        attachments: validAttachments,
      })
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    // Send admin notification email
    try {
      const adminEmail =
        process.env.ADMIN_NOTIFICATION_EMAIL ||
        process.env.ADMIN_EMAIL ||
        "admin@amasi.org"
      const resend = new Resend(process.env.RESEND_API_KEY?.trim())
      const adminUrl = `https://amasi-membership.vercel.app/admin/tickets/${data.ticket_number}`
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: adminEmail,
        subject: `[AMASI] New support ticket: ${data.subject} (${data.ticket_number})`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <h2 style="color: #0f766e; margin: 0 0 16px;">New Support Ticket</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px; color: #555;">
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Ticket #</td><td style="padding: 6px 0;">${data.ticket_number}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Name</td><td style="padding: 6px 0;">${name}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Email</td><td style="padding: 6px 0;">${email}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Category</td><td style="padding: 6px 0;">${category}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Priority</td><td style="padding: 6px 0;">${resolvedPriority}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Subject</td><td style="padding: 6px 0;">${subject}</td></tr>
            </table>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: #334155; margin: 0; white-space: pre-wrap;">${description.slice(0, 500)}${description.length > 500 ? "..." : ""}</p>
            </div>
            <p style="margin: 20px 0;"><a href="${adminUrl}" style="background: #0f766e; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">View Ticket in Admin</a></p>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Admin notification email error (new ticket):", emailErr)
    }

    return Response.json(data, { status: 201 })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get("email")
    const phone = searchParams.get("phone")
    const all = searchParams.get("all")
    const status = searchParams.get("status")

    if (!email && !phone && all !== "1") {
      return Response.json(
        { error: "Provide email, phone, or all=1 to list tickets" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    let query = supabase
      .from("support_tickets")
      .select("*")
      .order("created_at", { ascending: false })

    if (all !== "1") {
      if (email) {
        query = query.eq("email", email)
      }
      if (phone) {
        query = query.eq("phone", phone)
      }
    }

    if (status) {
      query = query.eq("status", status)
    }

    const { data, error } = await query

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json(data)
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
