import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

export async function GET(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { searchParams } = request.nextUrl
    const type = searchParams.get("type") || ""
    const state = searchParams.get("state") || ""
    const zone = searchParams.get("zone") || ""
    const status = searchParams.get("status") || ""
    const search = searchParams.get("q") || ""

    const supabase = createAdminClient()

    let query = supabase
      .from("members")
      .select(
        "amasi_number, name, email, phone, membership_type, status, state, city, pg_degree, mci_council_number, created_at"
      )
      .order("amasi_number", { ascending: true })

    if (search) {
      const clean = search.replace(/^dr\.?\s*/i, "").trim()
      if (clean.includes("@")) {
        query = query.ilike("email", `%${clean}%`)
      } else if (/^\d{10}$/.test(clean)) {
        query = query.eq("phone", clean)
      } else if (/^\d+$/.test(clean)) {
        query = query.eq("amasi_number", parseInt(clean))
      } else {
        query = query.ilike("name", `%${clean}%`)
      }
    }

    if (type) query = query.eq("membership_type", type)
    if (state) query = query.eq("state", state)
    if (status) query = query.eq("status", status)

    // Supabase limits rows per request to 1000 by default.
    // Fetch in batches to get ALL matching members.
    const PAGE = 1000
    let allRows: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await query.range(offset, offset + PAGE - 1)
      if (error) {
        console.error("Export query error:", error)
        return Response.json({ error: "Failed to fetch members" }, { status: 500 })
      }
      if (!data || data.length === 0) {
        hasMore = false
      } else {
        allRows = allRows.concat(data)
        if (data.length < PAGE) hasMore = false
        offset += PAGE
      }
    }

    // Build CSV
    const headers = [
      "AMASI Number",
      "Name",
      "Email",
      "Phone",
      "Membership Type",
      "Status",
      "State",
      "City",
      "PG Degree",
      "MCI Number",
      "Joining Date",
    ]

    const escapeCSV = (val: any) => {
      const str = String(val ?? "")
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const rows = allRows.map((m) =>
      [
        m.amasi_number,
        `Dr. ${m.name || ""}`,
        m.email || "",
        m.phone || "",
        m.membership_type || "",
        m.status || "",
        m.state || "",
        m.city || "",
        m.pg_degree || "",
        m.mci_council_number || "",
        m.created_at ? new Date(m.created_at).toISOString().split("T")[0] : "",
      ].map(escapeCSV).join(",")
    )

    const csv = [headers.map(escapeCSV).join(","), ...rows].join("\n")
    const date = new Date().toISOString().split("T")[0]

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename=amasi-members-export-${date}.csv`,
      },
    })
  } catch (error: any) {
    console.error("Export error:", error)
    return Response.json({ error: "Export failed" }, { status: 500 })
  }
}
