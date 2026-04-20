import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

/** Seed data — matches the 4 hardcoded templates that were in the notifications page */
const SEED_TEMPLATES = [
  {
    name: "Application Submitted",
    template_id: "application_submit_templeate",
    description: "Sent when a member submits their application",
    variables: ["Name"],
    is_active: true,
  },
  {
    name: "Membership Approved",
    template_id: "member_approve_template",
    description: "Sent when a membership application is approved",
    variables: ["Name", "Membership_Type", "Membership_Number"],
    is_active: true,
  },
  {
    name: "Payment Pending",
    template_id: "application_payment_pending",
    description: "Reminder for pending payment on an application",
    variables: ["Name", "APP_ID", "Date", "Url"],
    is_active: true,
  },
  {
    name: "Certificate Ready",
    template_id: "amasi_certificate_template",
    description: "Sent when a member certificate is ready for download",
    variables: ["Name", "Link", "Phone"],
    is_active: true,
  },
]

export async function GET() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("whatsapp_templates")
      .select("*")
      .order("created_at", { ascending: true })

    if (error) {
      // Table might not exist yet — return seed data as fallback
      if (error.code === "42P01" || error.message?.includes("does not exist")) {
        return Response.json(
          SEED_TEMPLATES.map((t, i) => ({
            id: `seed-${i}`,
            ...t,
            created_at: new Date().toISOString(),
          }))
        )
      }
      return Response.json({ error: error.message }, { status: 500 })
    }

    // If no templates in DB, auto-seed the defaults
    if (!data || data.length === 0) {
      const { data: seeded, error: seedError } = await supabase
        .from("whatsapp_templates")
        .insert(SEED_TEMPLATES)
        .select()

      if (seedError) {
        // If insert fails (e.g. table doesn't exist), return seed data directly
        return Response.json(
          SEED_TEMPLATES.map((t, i) => ({
            id: `seed-${i}`,
            ...t,
            created_at: new Date().toISOString(),
          }))
        )
      }

      return Response.json(seeded)
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
    const { name, template_id, description, variables, is_active } = body

    if (!name || !template_id) {
      return Response.json(
        { error: "name and template_id are required" },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("whatsapp_templates")
      .insert({
        name,
        template_id,
        description: description || null,
        variables: variables || [],
        is_active: is_active !== false,
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

    const allowed: Record<string, unknown> = {}
    if (updates.name !== undefined) allowed.name = updates.name
    if (updates.template_id !== undefined) allowed.template_id = updates.template_id
    if (updates.description !== undefined) allowed.description = updates.description || null
    if (updates.variables !== undefined) allowed.variables = updates.variables
    if (updates.is_active !== undefined) allowed.is_active = updates.is_active

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("whatsapp_templates")
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
      .from("whatsapp_templates")
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
