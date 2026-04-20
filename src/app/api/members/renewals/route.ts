import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

interface RenewalMember {
  id: string
  name: string
  email: string
  amasi_number: number
  membership_type: string
  joining_date: string
  expiryDate: string
  daysUntilExpiry: number
}

export async function GET(_request: NextRequest) {
  const session = await getAdminSession()
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 })

  try {
    const supabase = createAdminClient()

    // Fetch all ACM (Annual Conference Member) members
    const { data: acmMembers, error } = await supabase
      .from("members")
      .select("id, name, email, amasi_number, membership_type, joining_date")
      .eq("membership_type", "ACM")
      .not("joining_date", "is", null)

    if (error) {
      console.error("Renewals query error:", error.message)
      return Response.json({ error: error.message }, { status: 500 })
    }

    const now = new Date()
    const expired: RenewalMember[] = []
    const expiringSoon: RenewalMember[] = []

    for (const m of acmMembers || []) {
      const joiningDate = new Date(m.joining_date)
      const expiryDate = new Date(joiningDate)
      expiryDate.setFullYear(expiryDate.getFullYear() + 1)

      const diffMs = expiryDate.getTime() - now.getTime()
      const daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24))

      const entry: RenewalMember = {
        id: m.id,
        name: m.name,
        email: m.email,
        amasi_number: m.amasi_number,
        membership_type: m.membership_type,
        joining_date: m.joining_date,
        expiryDate: expiryDate.toISOString().split("T")[0],
        daysUntilExpiry,
      }

      if (daysUntilExpiry < 0) {
        expired.push(entry)
      } else if (daysUntilExpiry <= 30) {
        expiringSoon.push(entry)
      }
    }

    // Sort: expired by most overdue first, expiring by soonest first
    expired.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)
    expiringSoon.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry)

    // Count total active ACM (not expired)
    const totalActive = (acmMembers || []).length - expired.length

    return Response.json({ expired, expiringSoon, totalActive })
  } catch (err: any) {
    console.error("Renewals error:", err.message)
    return Response.json({ error: "Failed to fetch renewal data" }, { status: 500 })
  }
}
