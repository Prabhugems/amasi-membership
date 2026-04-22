import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

// Return all fields needed for status display AND resubmit form
const SELECT_FIELDS = "id, reference_number, name, first_name, middle_name, last_name, salutation, email, phone, mobile_code, membership_type, status, payment_status, ai_confidence, ai_verified, needs_manual_review, review_notes, assigned_amasi_number, created_at, reviewed_at, date_of_birth, gender, father_name, nationality, street_address_1, street_address_2, city, state, country, postal_code, zone, pg_degree, pg_college, pg_university, pg_year, ug_college, mci_council_number, mci_council_state, asi_membership_no, documents"

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("ref") || request.nextUrl.searchParams.get("q")
  const multi = request.nextUrl.searchParams.get("multi") === "1"

  if (!query || !query.trim()) {
    return Response.json(
      { status: false, message: "Please enter your reference number, email, or mobile number" },
      { status: 400 }
    )
  }

  // Rate limit: 15 requests per 15 minutes per IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`appstatus:${ip}`, 15, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
  }

  try {
    const supabase = createAdminClient()
    const q = query.trim()
    let data = null
    let dataList: unknown[] | null = null

    // Search by reference number first
    if (q.startsWith("AMASI-")) {
      const { data: result } = await supabase
        .from("membership_applications")
        .select(SELECT_FIELDS)
        .eq("reference_number", q)
        .single()
      data = result
    }

    // Search by email
    if (!data && q.includes("@")) {
      if (multi) {
        const { data: results } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .ilike("email", q)
          .order("created_at", { ascending: false })
          .limit(10)
        dataList = results
        data = results?.[0] || null
      } else {
        const { data: result } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .ilike("email", q)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()
        data = result
      }
    }

    // Search by phone
    if (!data && /^\d{10}$/.test(q)) {
      if (multi) {
        const { data: results } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .eq("phone", q)
          .order("created_at", { ascending: false })
          .limit(10)
        dataList = results
        data = results?.[0] || null
      } else {
        const { data: result } = await supabase
          .from("membership_applications")
          .select(SELECT_FIELDS)
          .eq("phone", q)
          .order("created_at", { ascending: false })
          .limit(1)
          .single()
        data = result
      }
    }

    // Fallback: try as reference number without prefix
    if (!data) {
      const { data: result } = await supabase
        .from("membership_applications")
        .select(SELECT_FIELDS)
        .eq("reference_number", q)
        .single()
      data = result
    }

    if (!data) {
      return Response.json(
        { status: false, message: "No application found. Please check your reference number, email, or mobile number." },
        { status: 404 }
      )
    }

    // Return multiple results if available, otherwise wrap single in array
    if (multi && dataList && dataList.length > 0) {
      return Response.json({ status: true, data: dataList[0], applications: dataList })
    }

    return Response.json({ status: true, data, applications: [data] })
  } catch (error: unknown) {
    console.error("Status lookup error:", error)
    return Response.json({ status: false, message: "Unable to check application status. Please try again." }, { status: 500 })
  }
}
