import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"

export async function GET(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref")

  if (!ref || !ref.trim()) {
    return Response.json(
      { status: false, message: "Reference number is required" },
      { status: 400 }
    )
  }

  try {
    const supabase = createAdminClient()

    const { data, error } = await supabase
      .from("membership_applications")
      .select(
        "id, reference_number, name, first_name, middle_name, last_name, salutation, membership_type, status, payment_status, ai_confidence, ai_verified, needs_manual_review, review_notes, assigned_amasi_number, created_at, reviewed_at"
      )
      .eq("reference_number", ref.trim())
      .single()

    if (error || !data) {
      return Response.json(
        { status: false, message: "No application found for this reference number" },
        { status: 404 }
      )
    }

    return Response.json({ status: true, data })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error"
    console.error("Status lookup error:", error)
    return Response.json({ status: false, message }, { status: 500 })
  }
}
