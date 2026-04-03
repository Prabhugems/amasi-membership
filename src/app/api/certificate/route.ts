import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const amasiNumber = request.nextUrl.searchParams.get("id")

  if (!amasiNumber) {
    return Response.json(
      { status: false, message: "Membership number required" },
      { status: 400 }
    )
  }

  try {
    const supabase = createAdminClient()

    // Fetch member data
    const { data: member, error: memberError } = await supabase
      .from("members")
      .select("*")
      .eq("amasi_number", parseInt(amasiNumber))
      .single()

    if (memberError || !member) {
      return Response.json(
        { status: false, message: "Member not found" },
        { status: 404 }
      )
    }

    const joiningDate = member.joining_date || member.application_date || member.created_at

    // Try to find signatory whose term covers the member's joining date
    let signatory = null

    if (joiningDate) {
      const { data: matchedSignatory } = await supabase
        .from("certificate_signatories")
        .select("*")
        .lte("from_date", joiningDate)
        .gte("to_date", joiningDate)
        .single()

      signatory = matchedSignatory
    }

    // Fallback: use the latest active signatory
    if (!signatory) {
      const { data: latestSignatory } = await supabase
        .from("certificate_signatories")
        .select("*")
        .eq("active", true)
        .order("to_date", { ascending: false })
        .limit(1)
        .single()

      signatory = latestSignatory
    }

    const mt = (member.membership_type || "").toLowerCase()
    const memberType = mt.includes("life member [lm]") || mt === "lm"
      ? "Life Member"
      : mt.includes("associate life") || mt === "alm"
        ? "Associate Life Member"
        : mt.includes("candidate") || mt === "acm"
          ? "Associate Candidate Member"
          : mt.includes("international") || mt === "ilm"
            ? "International Life Member"
            : member.membership_type || "Member"

    return Response.json({
      status: true,
      certificate: {
        amasiNumber: member.amasi_number,
        name: member.name,
        membershipType: memberType,
        pgDegree: member.pg_degree,
        mciNumber: member.mci_council_number,
        state: member.state,
        joiningDate,
        president: signatory?.president_name || null,
        presidentSignUrl: signatory?.president_sign_url || null,
        secretary: signatory?.secretary_name || null,
        secretarySignUrl: signatory?.secretary_sign_url || null,
        templateUrl: signatory?.template_url || "/certificates/term-2024-2026.png",
        certificateDate: joiningDate,
      },
    })
  } catch (error: any) {
    console.error("Certificate API error:", error)
    return Response.json(
      { status: false, message: error.message },
      { status: 500 }
    )
  }
}
