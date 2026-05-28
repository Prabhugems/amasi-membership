// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-invoice/<id>" to the
// native /api/payments/receipt HTML renderer. The legacy "invoice" and
// "receipt" rendered the same payment document — re-use the receipt
// handler until a distinct invoice template is needed.
//
// Same id-shape resolution as the receipt sibling: track-screen sends
// application id (UUID), so we resolve to email then forward as `ref`.
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
  const rl = await checkRateLimit(`shim-invoice:${ip}`, 30, 15 * 60 * 1000)
  if (!rl.allowed) {
    return new Response("Too many requests. Please try again later.", { status: 429 })
  }

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
    return new Response("Invoice not found — no application matches this id.", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  }

  return NextResponse.redirect(
    new URL(`/api/payments/receipt?ref=${encodeURIComponent(app.email)}`, request.url),
    307
  )
}
