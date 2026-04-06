import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
    }

    const { filter } = await request.json()
    const supabase = createAdminClient()

    let query = supabase
      .from("members")
      .select("*", { count: "exact", head: true })

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

    const { count, error } = await query

    if (error) {
      return Response.json({ status: false, message: error.message }, { status: 500 })
    }

    return Response.json({ status: true, count: count ?? 0 })
  } catch (error: any) {
    console.error("Notification count error:", error)
    return Response.json(
      { status: false, message: error.message || "Failed to count members" },
      { status: 500 }
    )
  }
}
