import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import QRCode from "qrcode"

export async function GET(request: NextRequest) {
  const amasiNumber = request.nextUrl.searchParams.get("id")

  if (!amasiNumber) {
    return Response.json({ status: false, message: "Membership number required" }, { status: 400 })
  }

  // Rate limit: 20 requests per 15 minutes per IP
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`card:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json({ status: false, message: "Too many requests" }, { status: 429 })
  }

  try {
    const supabase = createAdminClient()
    const { data: member, error } = await supabase
      .from("members")
      .select("*")
      .eq("amasi_number", parseInt(amasiNumber))
      .single()

    if (error || !member) {
      return Response.json({ status: false, message: "Member not found" }, { status: 404 })
    }

    // Generate QR code (links to verification page)
    const verifyUrl = `https://membership.amasi.org/verify?id=${member.amasi_number}`
    const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
      width: 200,
      margin: 1,
      color: { dark: "#0f766e", light: "#ffffff" },
    })

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
      card: {
        amasiNumber: member.amasi_number,
        name: member.name,
        salutation: member.salutation || "Dr.",
        membershipType: member.membership_type,
        membershipLabel: memberType,
        email: member.email,
        // members.phone is bigint in Postgres → JS number at runtime; coerce
        // so JSON consumers get a string (matches existing tel: link usage).
        phone: member.phone != null ? String(member.phone) : null,
        state: member.state,
        zone: member.zone,
        pgDegree: member.pg_degree,
        mciNumber: member.mci_council_number,
        joiningDate: member.joining_date || member.application_date || member.created_at,
        profilePhoto: member.profile_photo,
        votingEligible: member.voting_eligible,
        qrCode: qrDataUrl,
        verifyUrl,
      },
    })
  } catch (error) {
    console.error("Card API error:", error)
    return Response.json({ status: false, message: "Unable to load membership card. Please try again." }, { status: 500 })
  }
}
