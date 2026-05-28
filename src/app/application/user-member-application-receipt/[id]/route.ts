// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-receipt/<id>" to the
// native /api/payments/receipt HTML renderer. See migration/SHIM_README.md.
import { NextRequest, NextResponse } from "next/server"

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  return NextResponse.redirect(
    new URL(`/api/payments/receipt?id=${encodeURIComponent(id)}`, _request.url),
    307
  )
}
