import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession, getMemberSession } from "@/lib/auth"
import { checkRateLimit } from "@/lib/rate-limit"

// Public-safe field list for anonymous callers. Excludes PII such as email,
// phone, DOB, address, MCI number/state, and all document URLs except photo.
const PUBLIC_SELECT =
  "id, name, membership_type, amasi_number, city, state, zone, pg_degree, status, profile_photo"
// Authenticated-member field list: PUBLIC_SELECT plus contact fields the
// mobile member-directory needs for mailto:/tel: actions. Still excludes
// DOB, address, MCI, and document URLs.
const MEMBER_SELECT = `${PUBLIC_SELECT}, email, mobile, mobile_code`

// Union of fields the response mapper reads off a Supabase row. Every
// field is optional because the SELECT varies by auth tier (admin = *,
// member = MEMBER_SELECT, anonymous = PUBLIC_SELECT) and some columns
// only exist on certain rows. Used to type the mapper without `any`.
type MemberRow = {
  id?: string
  name?: string
  amasi_number?: number
  salutation?: string | null
  profile_photo?: string | null
  pg_degree?: string | null
  mci_council_number?: string | null
  date_of_birth?: string | null
  gender?: string | null
  phone?: string | number | null
  mobile_code?: string | null
  application_no?: string | null
  membership_type?: string | null
  city?: string | null
  status?: string | null
  state?: string | null
  application_date?: string | null
  created_at?: string | null
  joining_date?: string | null
  zone?: string | null
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const query = searchParams.get("q")

  if (!query) {
    return Response.json({ status: false, message: "Query parameter 'q' is required", data: [] }, { status: 400 })
  }

  // Auth-aware field selection: admins get the full record, authenticated
  // members get contact fields, anonymous callers get the limited public set.
  const adminSession = await getAdminSession()
  const memberSession = adminSession ? null : await getMemberSession()
  const isAdmin = !!adminSession
  const isMember = !!memberSession

  // Rate limit non-admin callers. Authed members get a higher ceiling to
  // accommodate type-as-you-go mobile search; anonymous callers stay at the
  // original web-widget cap.
  if (!isAdmin) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
    const limit = isMember ? 120 : 30
    const rl = await checkRateLimit(`members-search:${ip}`, limit, 15 * 60 * 1000)
    if (!rl.allowed) {
      return Response.json({ status: false, message: "Too many requests", data: [] }, { status: 429 })
    }
  }

  try {
    const supabase = createAdminClient()
    const isEmail = query.includes("@")
    const isPhone = /^\d{10}$/.test(query)

    const selectFields = isAdmin ? "*" : isMember ? MEMBER_SELECT : PUBLIC_SELECT

    let data = null

    if (isEmail) {
      const { data: result, error } = await supabase
        .from("members")
        .select(selectFields)
        .ilike("email", query.trim())
        .limit(1)
      if (error) console.error("members.search email query failed:", error)
      data = result
    } else if (isPhone) {
      const { data: result, error } = await supabase
        .from("members")
        .select(selectFields)
        .eq("phone", query.trim())
        .limit(1)
      if (error) console.error("members.search phone query failed:", error)
      data = result
    } else {
      // Search by name or amasi number
      const asNum = parseInt(query)
      if (!isNaN(asNum)) {
        const { data: result, error } = await supabase
          .from("members")
          .select(selectFields)
          .eq("amasi_number", asNum)
          .limit(1)
        if (error) console.error("members.search amasi_number query failed:", error)
        data = result
      } else {
        const { data: result, error } = await supabase
          .from("members")
          .select(selectFields)
          .ilike("name", `%${query}%`)
          .order("name", { ascending: true })
          .limit(30)
        if (error) console.error("members.search name query failed:", error)
        data = result
      }
    }

    if (data && data.length > 0) {
      return Response.json({
        status: true,
        message: "Member found",
        data: (data as unknown as MemberRow[]).map((m: MemberRow) => ({
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
          is_active: m.status === "active",
          state_name: m.state || "",
          mci_council_number: m.mci_council_number || "",
          member_reg_date: m.application_date || m.created_at,
          joining_date: m.joining_date || m.created_at,
          zone: m.zone || "",
        })),
      })
    }

    return Response.json({ status: false, message: "No data found.", data: [] })
  } catch (error: unknown) {
    console.error("Member search error:", error)
    return Response.json({ status: false, message: "Search failed", data: [] }, { status: 500 })
  }
}
