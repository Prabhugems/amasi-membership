import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

// Public-safe field list for non-admin callers. Excludes PII such as email,
// phone, DOB, address, MCI number/state, and all document URLs except photo.
const PUBLIC_SELECT =
  "id, name, membership_type, amasi_number, membership_no, city, state, zone, pg_degree, is_active, photo_url"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get("q")

  if (!query) {
    return Response.json({ status: false, message: "Query parameter 'q' is required", data: [] }, { status: 400 })
  }

  // Auth-aware field selection: admins get full record; everyone else
  // (logged-in members and anonymous callers) gets the limited, safe set.
  const adminSession = await getAdminSession()
  const memberSession = adminSession ? null : await getMemberSession()
  const isAdmin = !!adminSession
  // memberSession referenced for future member-self redaction; kept intentionally.
  void memberSession

  // Rate limit non-admin callers
  if (!isAdmin) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const rl = await checkRateLimit(`members-search:${ip}`, 30, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests", data: [] }, { status: 429 })
    }
  }

  try {
    const supabase = createAdminClient()
    const isEmail = query.includes("@")
    const isPhone = /^\d{10}$/.test(query)

    const selectFields = isAdmin ? "*" : PUBLIC_SELECT

    let data = null

    if (isEmail) {
      const { data: result } = await supabase
        .from("members")
        .select(selectFields)
        .ilike("email", query.trim())
        .limit(1)
      data = result
    } else if (isPhone) {
      const { data: result } = await supabase
        .from("members")
        .select(selectFields)
        .eq("phone", query.trim())
        .limit(1)
      data = result
    } else {
      // Search by name or amasi number
      const asNum = parseInt(query)
      if (!isNaN(asNum)) {
        const { data: result } = await supabase
          .from("members")
          .select(selectFields)
          .eq("amasi_number", asNum)
          .limit(1)
        data = result
      } else {
        const { data: result } = await supabase
          .from("members")
          .select(selectFields)
          .ilike("name", `%${query}%`)
          .limit(5)
        data = result
      }
    }

    if (data && data.length > 0) {
      return Response.json({
        status: true,
        message: "Member found",
        data: (data as any[]).map((m: any) => ({
          ...m,
          _id: m.id, // Supabase row ID for update API
          profile_incomplete: !m.pg_degree && !m.mci_council_number && !m.date_of_birth && !m.gender,
          // Map to match old API field names for compatibility
          membership_no: m.amasi_number,
          first_name: m.name?.split(" ")[0] || "",
          middle_name: "",
          last_name: m.name?.split(" ").slice(1).join(" ") || "",
          salutation: m.salutation || "Dr.",
          mobile: String(m.phone || ""),
          mobile_code: m.mobile_code || "+91",
          dob: m.date_of_birth || "",
          application_no: m.application_no || "",
          membership_type: m.membership_type || "",
          city: m.city || "",
          application_name: (() => {
            const t = m.membership_type
            if (t === "LM") return "Life Member"
            if (t === "ALM") return "Associate Life Member"
            if (t === "ACM") return "Associate Candidate Member"
            if (t === "ILM") return "International Life Member"
            return t || ""
          })(),
          status_name: m.status === "active" ? "Membership Number Allotted" : m.status,
          state_name: m.state || "",
          mci_council_number: m.mci_council_number || "",
          member_reg_date: m.application_date || m.created_at,
          joining_date: m.joining_date || m.created_at,
          zone: m.zone || "",
        })),
      })
    }

    return Response.json({ status: false, message: "No data found.", data: [] })
  } catch (error: any) {
    console.error("Member search error:", error)
    return Response.json({ status: false, message: "Search failed", data: [] }, { status: 500 })
  }
}
