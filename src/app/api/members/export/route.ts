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

    const supabase = createAdminClient()

    const SELECT_FIELDS = [
      "amasi_number",
      "name",
      "email",
      "phone",
      "membership_type",
      "zone",
      "state",
      "city",
      "joining_date",
      "pg_degree",
      "mci_council_number",
      "is_active",
    ].join(", ")

    let baseQuery = supabase
      .from("members")
      .select(SELECT_FIELDS)
      .order("amasi_number", { ascending: true })

    if (type) {
      baseQuery = baseQuery.eq("membership_type", type)
    }

    // Batched fetch — 1000 rows per request to handle large datasets
    const BATCH = 1000
    let allRows: any[] = []
    let offset = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await baseQuery.range(offset, offset + BATCH - 1)
      if (error) {
        console.error("Export query error:", error)
        return Response.json({ error: "Failed to fetch members" }, { status: 500 })
      }
      if (!data || data.length === 0) {
        hasMore = false
      } else {
        allRows = allRows.concat(data)
        if (data.length < BATCH) hasMore = false
        offset += BATCH
      }
    }

    // CSV helpers
    const escapeCSV = (val: any) => {
      const str = String(val ?? "")
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    }

    const headers = [
      "AMASI Number",
      "Name",
      "Email",
      "Phone",
      "Membership Type",
      "Zone",
      "State",
      "City",
      "Joining Date",
      "PG Degree",
      "MCI Council Number",
      "Is Active",
    ]

    const rows = allRows.map((m) =>
      [
        m.amasi_number,
        m.name || "",
        m.email || "",
        m.phone || "",
        m.membership_type || "",
        m.zone || "",
        m.state || "",
        m.city || "",
        m.joining_date || "",
        m.pg_degree || "",
        m.mci_council_number || "",
        m.is_active != null ? String(m.is_active) : "",
      ]
        .map(escapeCSV)
        .join(",")
    )

    const csv = [headers.map(escapeCSV).join(","), ...rows].join("\n")
    const date = new Date().toISOString().split("T")[0]

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="amasi-members-${date}.csv"`,
      },
    })
  } catch (error: any) {
    console.error("Export error:", error)
    return Response.json({ error: "Export failed" }, { status: 500 })
  }
}
