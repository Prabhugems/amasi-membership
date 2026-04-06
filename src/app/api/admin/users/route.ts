import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET() {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Only super_admin (env-var admin or DB super_admin) can manage users
    if (session.adminRole !== "super_admin") {
      return Response.json({ error: "Forbidden — super admin only" }, { status: 403 })
    }

    const supabase = createAdminClient()
    const { data, error } = await supabase
      .from("admin_users")
      .select("id, email, name, role, permissions, is_active, last_login, created_at")
      .order("created_at", { ascending: false })

    if (error) {
      console.error("List admin users error:", error)
      return Response.json({ error: "Failed to fetch admin users" }, { status: 500 })
    }

    return Response.json({ status: true, data: data || [] })
  } catch (error: any) {
    console.error("Admin users GET error:", error)
    return Response.json({ error: "Failed to fetch admin users" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.adminRole !== "super_admin") {
      return Response.json({ error: "Forbidden — super admin only" }, { status: 403 })
    }

    const { name, email, password, role } = await request.json()

    if (!name || !email || !password) {
      return Response.json({ error: "Name, email, and password are required" }, { status: 400 })
    }

    const validRoles = ["super_admin", "admin", "reviewer"]
    if (role && !validRoles.includes(role)) {
      return Response.json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Check if email already exists
    const { data: existing } = await supabase
      .from("admin_users")
      .select("id")
      .eq("email", email.trim().toLowerCase())
      .limit(1)

    if (existing && existing.length > 0) {
      return Response.json({ error: "An admin with this email already exists" }, { status: 409 })
    }

    // Create using the RPC function which hashes the password
    const { data: newId, error } = await supabase.rpc("create_admin_user", {
      p_email: email.trim().toLowerCase(),
      p_name: name.trim(),
      p_password: password,
      p_role: role || "reviewer",
    })

    if (error) {
      console.error("Create admin user error:", error)
      return Response.json({ error: "Failed to create admin user" }, { status: 500 })
    }

    return Response.json({ status: true, id: newId, message: "Admin user created successfully" })
  } catch (error: any) {
    console.error("Admin users POST error:", error)
    return Response.json({ error: "Failed to create admin user" }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.adminRole !== "super_admin") {
      return Response.json({ error: "Forbidden — super admin only" }, { status: 403 })
    }

    const { id, is_active, role } = await request.json()

    if (!id) {
      return Response.json({ error: "Admin user ID is required" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const updates: Record<string, any> = { updated_at: new Date().toISOString() }

    if (typeof is_active === "boolean") updates.is_active = is_active
    if (role) {
      const validRoles = ["super_admin", "admin", "reviewer"]
      if (!validRoles.includes(role)) {
        return Response.json({ error: "Invalid role" }, { status: 400 })
      }
      updates.role = role
    }

    const { error } = await supabase
      .from("admin_users")
      .update(updates)
      .eq("id", id)

    if (error) {
      console.error("Update admin user error:", error)
      return Response.json({ error: "Failed to update admin user" }, { status: 500 })
    }

    return Response.json({ status: true, message: "Admin user updated" })
  } catch (error: any) {
    console.error("Admin users PATCH error:", error)
    return Response.json({ error: "Failed to update admin user" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    if (session.adminRole !== "super_admin") {
      return Response.json({ error: "Forbidden — super admin only" }, { status: 403 })
    }

    const { id } = await request.json()
    if (!id) {
      return Response.json({ error: "Admin user ID is required" }, { status: 400 })
    }

    const supabase = createAdminClient()
    const { error } = await supabase
      .from("admin_users")
      .delete()
      .eq("id", id)

    if (error) {
      console.error("Delete admin user error:", error)
      return Response.json({ error: "Failed to delete admin user" }, { status: 500 })
    }

    return Response.json({ status: true, message: "Admin user deleted" })
  } catch (error: any) {
    console.error("Admin users DELETE error:", error)
    return Response.json({ error: "Failed to delete admin user" }, { status: 500 })
  }
}
