// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-certificate-mobile/<id>"
// to the native /member/certificate viewer.
//
// Three call sites in the Flutter binary supply different ID shapes:
//   - Setting.dart:78 — hiveMethod.userid = members.id (UUID)
//   - application_track_details.dart:425 — appData["id"] (application id, UUID)
//   - numeric AMASI number (e.g. from a server-driven URL we construct)
//
// /api/certificate takes an integer amasi_number, so we resolve any
// non-numeric id (member UUID OR application UUID) server-side before
// redirecting.
// See migration/SHIM_README.md.
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // Rate limit per IP — defense in depth against UUID enumeration via redirect.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`shim-cert:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return new Response("Too many requests. Please try again later.", { status: 429 })
  }

  // Numeric id → already an AMASI number; pass through.
  if (/^\d+$/.test(id)) {
    return NextResponse.redirect(
      new URL(`/member/certificate?id=${encodeURIComponent(id)}`, request.url),
      307
    )
  }

  const supabase = createAdminClient()

  // UUID could be either members.id (Setting screen) or
  // membership_applications.id (Track screen). Try member first, then app.
  const { data: member } = await supabase
    .from("members")
    .select("amasi_number")
    .eq("id", id)
    .maybeSingle()

  let amasiNumber = member?.amasi_number ?? null

  if (amasiNumber == null) {
    const { data: app } = await supabase
      .from("membership_applications")
      .select("assigned_amasi_number, status")
      .eq("id", id)
      .maybeSingle()
    if (app) {
      amasiNumber = app.assigned_amasi_number ?? null
      if (amasiNumber == null && app.status !== "approved") {
        return new Response(
          "Your application is still under review. Your membership certificate will be available once approved.",
          { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        )
      }
    }
  }

  if (amasiNumber == null) {
    return new Response(
      "Membership certificate not available — no approved record found for this id.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    )
  }

  return NextResponse.redirect(
    new URL(`/member/certificate?id=${amasiNumber}`, request.url),
    307
  )
}
