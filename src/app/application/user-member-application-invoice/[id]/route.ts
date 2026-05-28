// Mobile-shim legacy path: redirects the Flutter binary's hardcoded
// certificateBaseUrl + "user-member-application-invoice/<id>" to the
// native /api/payments/receipt HTML renderer. The legacy "invoice" and
// "receipt" rendered the same payment document — re-use the receipt
// handler until a distinct invoice template is needed. See
// migration/SHIM_README.md.
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
