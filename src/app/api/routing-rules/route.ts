import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("ticket_routing_rules")
      .select("*")
      .order("created_at", { ascending: true })

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

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { category, assigned_to, priority_override, active } = body

    if (!category || !assigned_to) {
      return Response.json(
        { error: "category and assigned_to are required" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("ticket_routing_rules")
      .insert({
        category,
        assigned_to,
        priority_override: priority_override || null,
        active: active !== false,
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

export async function PATCH(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const body = await request.json()
    const { id, ...updates } = body

    if (!id) {
      return Response.json({ error: "id is required" }, { status: 400 })
    }

    // Only allow specific fields to be updated
    const allowed: Record<string, unknown> = {}
    if (updates.category !== undefined) allowed.category = updates.category
    if (updates.assigned_to !== undefined) allowed.assigned_to = updates.assigned_to
    if (updates.priority_override !== undefined) allowed.priority_override = updates.priority_override || null
    if (updates.active !== undefined) allowed.active = updates.active

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("ticket_routing_rules")
      .update(allowed)
      .eq("id", id)
      .select()
      .single()

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

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const id = searchParams.get("id")

    if (!id) {
      return Response.json({ error: "id query param is required" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("ticket_routing_rules")
      .delete()
      .eq("id", id)

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    return Response.json({ success: true })
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Internal server error" },
      { status: 500 }
    )
  }
}
