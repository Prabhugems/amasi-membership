// @auth: public — membership card view by AMASI number; rendered into emails
// and on the public /m/[id] page. Rate-limited per IP.
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"
import QRCode from "qrcode"
import { signStorageValue } from "@/lib/storage-url"

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

    // PII (email, phone) intentionally omitted from this public endpoint.
    // Members who need their own contact info should call an authenticated
    // endpoint (e.g. /api/auth/me) — anyone with an AMASI number can hit
    // this route, so contact details would enable enumeration harvesting.
    return Response.json({
      status: true,
      card: {
        amasiNumber: member.amasi_number,
        name: member.name,
        salutation: member.salutation || "Dr.",
        membershipType: member.membership_type,
        membershipLabel: memberType,
        state: member.state,
        zone: member.zone,
        pgDegree: member.pg_degree,
        mciNumber: member.mci_council_number,
        joiningDate: member.joining_date || member.application_date || member.created_at,
        // Phase B: sign at the API boundary — the stored value is a path (new
        // rows) or a legacy public URL (old rows), neither of which resolves
        // once the uploads bucket goes private.
        profilePhoto: await signStorageValue(member.profile_photo),
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
