// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-certificate-mobile/<id>"
// to the native /member/certificate viewer.
//
// Two call sites in the Flutter binary supply different ID shapes:
//   - view/home_main/Setting.dart:78 — hiveMethod.userid = members.id (UUID)
//   - view/application/application_track_details.dart:425 — appData["id"]
//     (application id, currently UNRESOLVED — see SHIM_README.md residual gap)
//
// /api/certificate takes an integer amasi_number, so we resolve UUID → AMASI
// number server-side before redirecting. Numeric ids pass through as-is.
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

  // UUID → resolve to AMASI number via members table.
  const supabase = createAdminClient()
  const { data: member, error } = await supabase
    .from("members")
    .select("amasi_number")
    .eq("id", id)
    .maybeSingle()

  if (error || !member) {
    return new Response(
      "Member not found. Your account may not exist or has not been approved yet.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    )
  }

  if (member.amasi_number == null) {
    return new Response(
      "Your application is still under review. Your membership certificate will be available once approved.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    )
  }

  return NextResponse.redirect(
    new URL(`/member/certificate?id=${member.amasi_number}`, request.url),
    307
  )
}
