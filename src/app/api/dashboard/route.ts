import { createAdminClient } from "@/lib/supabase"

export async function GET() {
  try {
    const supabase = createAdminClient()

    // Run all queries in parallel
    const [
      totalMembersRes,
      membersByTypeRes,
      recentApplicationsRes,
      pendingApplicationsRes,
      incompleteProfilesRes,
      totalPaymentsRes,
    ] = await Promise.all([
      // Total members count
      supabase.from("members").select("*", { count: "exact", head: true }),

      // Members by type — run 4 separate count queries to avoid row limit
      Promise.all([
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "LM"),
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "ALM"),
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "ACM"),
        supabase.from("members").select("*", { count: "exact", head: true }).eq("membership_type", "ILM"),
      ]),

      // Recent 10 applications
      supabase
        .from("membership_applications")
        .select("id, reference_number, full_name, membership_type, status, payment_status, created_at")
        .order("created_at", { ascending: false })
        .limit(10),

      // Pending applications count
      supabase
        .from("membership_applications")
        .select("*", { count: "exact", head: true })
        .in("status", ["pending", "submitted", "pending_review"]),

      // Members with incomplete profiles (missing all four key fields)
      supabase
        .from("members")
        .select("*", { count: "exact", head: true })
        .or("pg_degree.is.null,mci_council_number.is.null,date_of_birth.is.null,gender.is.null"),

      // Total payments received
      supabase
        .from("membership_payments")
        .select("amount")
        .eq("status", "paid"),
    ])

    // Compute members by type counts
    const [lmRes, almRes, acmRes, ilmRes] = membersByTypeRes as any
    const typeCounts: Record<string, number> = {
      LM: lmRes?.count || 0,
      ALM: almRes?.count || 0,
      ACM: acmRes?.count || 0,
      ILM: ilmRes?.count || 0,
    }

    // Sum total payments
    let totalPayments = 0
    if (totalPaymentsRes.data) {
      for (const row of totalPaymentsRes.data) {
        totalPayments += Number(row.amount) || 0
      }
    }

    return Response.json({
      status: true,
      data: {
        totalMembers: totalMembersRes.count ?? 0,
        membersByType: typeCounts,
        recentApplications: recentApplicationsRes.data ?? [],
        pendingApplicationsCount: pendingApplicationsRes.count ?? 0,
        incompleteProfilesCount: incompleteProfilesRes.count ?? 0,
        totalPayments,
      },
    })
  } catch (error: any) {
    console.error("Dashboard API error:", error)
    return Response.json(
      { status: false, message: "Failed to load dashboard stats" },
      { status: 500 }
    )
  }
}
