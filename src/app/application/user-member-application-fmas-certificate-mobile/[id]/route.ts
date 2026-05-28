// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-fmas-certificate-mobile/<id>"
// to the native /member/fmas-certificate viewer.
//
// Same ID-shape resolution as the membership-cert sibling — id can be
// numeric (AMASI number), a members.id UUID (Setting screen), or a
// membership_applications.id UUID (Track screen).
// See migration/SHIM_README.md.
import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`shim-fmas:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return new Response("Too many requests. Please try again later.", { status: 429 })
  }

  if (/^\d+$/.test(id)) {
    return NextResponse.redirect(
      new URL(`/member/fmas-certificate?id=${encodeURIComponent(id)}`, request.url),
      307
    )
  }

  const supabase = createAdminClient()

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
          "Your application is still under review. Your FMAS certificate will be available once approved.",
          { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        )
      }
    }
  }

  if (amasiNumber == null) {
    return new Response(
      "FMAS certificate not available — no approved record found for this id.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    )
  }

  return NextResponse.redirect(
    new URL(`/member/fmas-certificate?id=${amasiNumber}`, request.url),
    307
  )
}
