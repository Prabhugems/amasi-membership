// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-receipt/<id>" to the
// native /api/payments/receipt HTML renderer.
//
// Flutter's track-screen Download Receipt button supplies `<id>` as the
// application id (membership_applications.id) — NOT the payment id that
// /api/payments/receipt expects. Resolve here: find the application's
// email, then redirect with `ref=<email>` (the receipt route's email
// fallback returns the latest payment for that address).
//
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
  const rl = await checkRateLimit(`shim-receipt:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return new Response("Too many requests. Please try again later.", { status: 429 })
  }

  // If id is a UUID, it's an application id from the track screen — look
  // up the application's email and forward to receipt as ref. Otherwise
  // pass through as the receipt's `id` param.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.redirect(
      new URL(`/api/payments/receipt?id=${encodeURIComponent(id)}`, request.url),
      307
    )
  }

  const supabase = createAdminClient()
  const { data: app } = await supabase
    .from("membership_applications")
    .select("email")
    .eq("id", id)
    .maybeSingle()

  if (!app?.email) {
    return new Response("Receipt not found — no application matches this id.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  return NextResponse.redirect(
    new URL(`/api/payments/receipt?ref=${encodeURIComponent(app.email)}`, request.url),
    307
  )
}
