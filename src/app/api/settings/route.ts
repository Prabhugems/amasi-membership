// @auth: public — legacy mobile shim endpoint. The Flutter v1.0.4+2 binary
// calls /api/settings at app boot and reads data[0].razor_key_id, which it
// feeds into razorpay_flutter's Razorpay().open() (member_application.dart:111).
// Per the migration directive, this shim returns ONLY the live Razorpay key_id
// (legacy backend leaked razor_key_secret + smtp_password — do not replicate).
//
// See migration/MIGRATION_FINDINGS.md §3 and migration/backend-spec.md §1.

import { legacyOk, legacyErr } from "@/lib/mobile-shim"

export async function GET() {
  const key = process.env.RAZORPAY_KEY_ID?.trim()
  if (!key) {
    return legacyErr("Razorpay configuration unavailable")
  }
  return legacyOk("Get setting data", {
    data: [
      {
        razor_key_id: key,
      },
    ],
  })
}

// Legacy backend mounted /settings with multer.single('profile') middleware
// even though the body is unused. Accept POST too so a misconfigured client
// can't 405.
export const POST = GET
