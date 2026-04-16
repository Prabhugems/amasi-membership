import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { verifyMemberOwnership } from "@/lib/member-ownership"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return Response.json({ status: false, message: "Member ID is required" }, { status: 400 })
  }

  const adminSession = await getAdminSession()
  const memberSession = await getMemberSession()
  if (!adminSession && !memberSession) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const supabase = createAdminClient()

    // IDOR guard: non-admin members may only read their own clinics
    if (!adminSession && memberSession?.email) {
      const ok = await verifyMemberOwnership(supabase, String(memberSession.email), id)
      if (!ok) return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("member_clinics")
      .select("*")
      .eq("member_id", id)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Fetch clinics error:", error)
      return Response.json({ status: false, message: "Failed to fetch clinics" }, { status: 500 })
    }

    return Response.json({ status: true, data })
  } catch (error: any) {
    console.error("Fetch clinics error:", error)
    return Response.json({ status: false, message: "Failed to fetch clinics" }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return Response.json({ status: false, message: "Member ID is required" }, { status: 400 })
  }

  const adminSession = await getAdminSession()
  const memberSession = await getMemberSession()
  if (!adminSession && !memberSession) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { clinics } = body as {
      clinics: {
        clinic_name: string
        address: string
        city: string
        state: string
        country: string
        pin_code: string
        phone: string
        is_primary: boolean
      }[]
    }

    if (!clinics || !Array.isArray(clinics)) {
      return Response.json({ status: false, message: "Clinics array is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // IDOR guard: non-admin members may only modify their own clinics
    if (!adminSession && memberSession?.email) {
      const ok = await verifyMemberOwnership(supabase, String(memberSession.email), id)
      if (!ok) return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    // Delete existing clinics for this member
    const { error: deleteError } = await supabase
      .from("member_clinics")
      .delete()
      .eq("member_id", id)

    if (deleteError) {
      console.error("Delete clinics error:", deleteError)
      return Response.json({ status: false, message: "Failed to update clinics" }, { status: 500 })
    }

    // Insert new clinics
    if (clinics.length > 0) {
      const rows = clinics.map((clinic) => ({
        member_id: id,
        clinic_name: clinic.clinic_name,
        address: clinic.address,
        city: clinic.city,
        state: clinic.state,
        country: clinic.country,
        pin_code: clinic.pin_code,
        phone: clinic.phone,
        is_primary: clinic.is_primary,
      }))

      const { error: insertError } = await supabase
        .from("member_clinics")
        .insert(rows)

      if (insertError) {
        console.error("Insert clinics error:", insertError)
        return Response.json({ status: false, message: "Failed to save clinics" }, { status: 500 })
      }
    }

    return Response.json({ status: true, message: "Clinics saved successfully" })
  } catch (error: any) {
    console.error("Save clinics error:", error)
    return Response.json({ status: false, message: "Failed to save clinics" }, { status: 500 })
  }
}
