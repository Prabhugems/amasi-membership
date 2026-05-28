// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-fmas-certificate-mobile/<id>"
// to the native /member/fmas-certificate viewer.
//
// Flutter passes hiveMethod.userid = members.id (UUID) at Setting.dart:94.
// /member/fmas-certificate expects an amasi_number, so we resolve the UUID
// server-side first. See migration/SHIM_README.md.
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
      "Your application is still under review. Your FMAS certificate will be available once approved.",
      { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }
    )
  }

  return NextResponse.redirect(
    new URL(`/member/fmas-certificate?id=${member.amasi_number}`, request.url),
    307
  )
}
