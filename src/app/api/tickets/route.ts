import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"

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

    const validPriorities = ["low", "normal", "high", "urgent"]
    const resolvedPriority = validPriorities.includes(priority) ? priority : "normal"

    // SLA deadline based on priority
    const slaHours: Record<string, number> = { urgent: 2, high: 8, normal: 24, low: 72 }
    const slaMs = (slaHours[resolvedPriority] ?? 24) * 60 * 60 * 1000
    const sla_due_at = new Date(Date.now() + slaMs).toISOString()

    const supabase = createAdminClient()

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

    // Auto-assign via routing rules
    let autoAssignedTo: string | null = null
    let finalPriority = resolvedPriority
    try {
      const { data: rule } = await supabase
        .from("ticket_routing_rules")
        .select("assigned_to, priority_override")
        .eq("category", category)
        .eq("active", true)
        .limit(1)
        .single()
      if (rule) {
        autoAssignedTo = rule.assigned_to
        if (rule.priority_override) {
          finalPriority = rule.priority_override
        }
      }
    } catch {
      // No matching rule — leave unassigned
    }

    // Recalculate SLA if priority was overridden
    const finalSlaMs = (slaHours[finalPriority] ?? 24) * 60 * 60 * 1000
    const finalSlaDueAt = new Date(Date.now() + finalSlaMs).toISOString()

    // Retry on ticket_number collision (unique constraint)
    let data = null
    let error = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const ticket_number = generateTicketNumber()
      const result = await supabase
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
          priority: finalPriority,
          attachments: validAttachments,
          sla_due_at: finalSlaDueAt,
          ...(autoAssignedTo ? { assigned_to: autoAssignedTo } : {}),
        })
        .select()
        .single()

      if (!result.error) {
        data = result.data
        error = null
        break
      }
      if (result.error.code === "23505") {
        // Unique violation — retry with new number
        continue
      }
      error = result.error
      break
    }

    if (error || !data) {
      return Response.json({ error: error?.message || "Failed to create ticket" }, { status: 500 })
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
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Name</td><td style="padding: 6px 0;">${escapeHtml(name)}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Email</td><td style="padding: 6px 0;">${escapeHtml(email)}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Category</td><td style="padding: 6px 0;">${escapeHtml(category)}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Priority</td><td style="padding: 6px 0;">${escapeHtml(resolvedPriority)}</td></tr>
              <tr><td style="padding: 6px 12px 6px 0; font-weight: bold;">Subject</td><td style="padding: 6px 0;">${escapeHtml(subject)}</td></tr>
            </table>
            <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
              <p style="color: #334155; margin: 0; white-space: pre-wrap;">${escapeHtml(description.slice(0, 500))}${description.length > 500 ? "..." : ""}</p>
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
    const q = searchParams.get("q")?.trim() || ""

    if (!email && !phone && all !== "1") {
      return Response.json(
        { error: "Provide email, phone, or all=1 to list tickets" },
        { status: 400 }
      )
    }

    // all=1 requires admin auth — prevents unauthenticated full-table dump
    if (all === "1") {
      const session = await getAdminSession()
      if (!session) {
        return Response.json({ error: "Unauthorized" }, { status: 401 })
      }
    }

    const supabase = createAdminClient()

    // Full-text search when q is provided with admin auth (all=1)
    if (q && all === "1") {
      let data: Record<string, unknown>[] | null = null
      let searchError: { message: string } | null = null
      try {
        let tsQuery = supabase
          .from("support_tickets")
          .select("*")
          .is("merged_into", null)
          .textSearch("search_vector", q, { type: "websearch" })
          .order("created_at", { ascending: false })
        if (status) tsQuery = tsQuery.eq("status", status)
        const result = await tsQuery
        data = result.data
        searchError = result.error
      } catch {
        searchError = { message: "textSearch unavailable" }
      }
      if (searchError || !data) {
        const pattern = `%${q}%`
        let fallbackQuery = supabase
          .from("support_tickets")
          .select("*")
          .is("merged_into", null)
          .or(`name.ilike.${pattern},email.ilike.${pattern},ticket_number.ilike.${pattern},subject.ilike.${pattern},description.ilike.${pattern}`)
          .order("created_at", { ascending: false })
        if (status) fallbackQuery = fallbackQuery.eq("status", status)
        const fallbackResult = await fallbackQuery
        if (fallbackResult.error) {
          return Response.json({ error: fallbackResult.error.message }, { status: 500 })
        }
        return Response.json(fallbackResult.data)
      }
      return Response.json(data)
    }

    // Members see only safe columns; admins see everything
    const selectCols = all === "1"
      ? "*"
      : "id, ticket_number, subject, status, priority, category, created_at, updated_at"

    let query = supabase
      .from("support_tickets")
      .select(selectCols)
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
