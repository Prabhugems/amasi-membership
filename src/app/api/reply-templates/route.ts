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
      .from("reply_templates")
      .select("*")
      .eq("active", true)
      .order("sort_order", { ascending: true })

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
    const { title, body: templateBody } = body

    if (!title || !templateBody) {
      return Response.json(
        { error: "title and body are required" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Get the next sort_order
    const { data: maxRow } = await supabase
      .from("reply_templates")
      .select("sort_order")
      .order("sort_order", { ascending: false })
      .limit(1)
      .single()

    const nextOrder = (maxRow?.sort_order ?? 0) + 1

    const { data, error } = await supabase
      .from("reply_templates")
      .insert({
        title,
        body: templateBody,
        sort_order: nextOrder,
        created_by: (session as Record<string, unknown>).email as string || null,
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
    if (updates.title !== undefined) allowed.title = updates.title
    if (updates.body !== undefined) allowed.body = updates.body
    if (updates.active !== undefined) allowed.active = updates.active
    if (updates.sort_order !== undefined) allowed.sort_order = updates.sort_order
    allowed.updated_at = new Date().toISOString()

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("reply_templates")
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
      .from("reply_templates")
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
