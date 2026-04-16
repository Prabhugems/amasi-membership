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

    // IDOR guard: non-admin members may only read their own experiences
    if (!adminSession && memberSession?.email) {
      const ok = await verifyMemberOwnership(supabase, String(memberSession.email), id)
      if (!ok) return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    const { data, error } = await supabase
      .from("member_experiences")
      .select("*")
      .eq("member_id", id)
      .order("created_at", { ascending: false })

    if (error) {
      console.error("Fetch experiences error:", error)
      return Response.json({ status: false, message: "Failed to fetch experiences" }, { status: 500 })
    }

    return Response.json({ status: true, data })
  } catch (error: any) {
    console.error("Fetch experiences error:", error)
    return Response.json({ status: false, message: "Failed to fetch experiences" }, { status: 500 })
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
    const { experiences } = body as {
      experiences: {
        position: string
        institution: string
        experience_from: string
        experience_to: string
        total_years: number
        is_current: boolean
      }[]
    }

    if (!experiences || !Array.isArray(experiences)) {
      return Response.json({ status: false, message: "Experiences array is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // IDOR guard: non-admin members may only modify their own experiences
    if (!adminSession && memberSession?.email) {
      const ok = await verifyMemberOwnership(supabase, String(memberSession.email), id)
      if (!ok) return Response.json({ error: "Forbidden" }, { status: 403 })
    }

    // Delete existing experiences for this member
    const { error: deleteError } = await supabase
      .from("member_experiences")
      .delete()
      .eq("member_id", id)

    if (deleteError) {
      console.error("Delete experiences error:", deleteError)
      return Response.json({ status: false, message: "Failed to update experiences" }, { status: 500 })
    }

    // Insert new experiences
    if (experiences.length > 0) {
      const rows = experiences.map((exp) => ({
        member_id: id,
        position: exp.position,
        institution: exp.institution,
        experience_from: exp.experience_from,
        experience_to: exp.experience_to,
        total_years: exp.total_years,
        is_current: exp.is_current,
      }))

      const { error: insertError } = await supabase
        .from("member_experiences")
        .insert(rows)

      if (insertError) {
        console.error("Insert experiences error:", insertError)
        return Response.json({ status: false, message: "Failed to save experiences" }, { status: 500 })
      }
    }

    return Response.json({ status: true, message: "Experiences saved successfully" })
  } catch (error: any) {
    console.error("Save experiences error:", error)
    return Response.json({ status: false, message: "Failed to save experiences" }, { status: 500 })
  }
}
