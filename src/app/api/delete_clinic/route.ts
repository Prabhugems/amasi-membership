// @auth: public — legacy mobile shim. The legacy delete-by-id had no
// ownership check (data-loss vector: anyone with a clinic UUID could
// delete it). The Flutter call site (member_application.dart:302) is the
// apply-wizard "Remove address" button and doesn't pass any auth context
// we could verify against.
//
// Rather than reproduce that vector OR keep the noisy "feature updating"
// toast, redirect users to the web portal where they can remove clinics
// with a real session. Acceptable because the apply wizard's resume flow
// is already degraded for this binary (see member_info section in
// SHIM_README) — primary intake for clinic edits has moved to the web.
//
// See migration/SHIM_README.md.

import { legacyErr } from "@/lib/mobile-shim"

export async function POST() {
  return legacyErr(
    "To remove a clinic address, please visit membership.amasi.org and sign in to update your profile."
  )
}

export const GET = POST
