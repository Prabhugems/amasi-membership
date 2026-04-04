import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

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
    const { name, email, phone, amasi_number, category, subject, description, priority } = body

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
      })
      .select()
      .single()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
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
