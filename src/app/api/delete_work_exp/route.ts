// @auth: public — legacy mobile shim. Same ownership-check gap as
// delete_clinic, plus the legacy `tbl_work_exp` shape (surgical-
// procedure-count rows per member) has no equivalent in the new schema
// — `member_experiences` holds positions/institutions, not procedure
// counts. Redirect to the web portal.
//
// See migration/SHIM_README.md.

import { legacyErr } from "@/lib/mobile-shim"

export async function POST() {
  return legacyErr(
    "To update your work experience, please visit membership.amasi.org and sign in to manage your profile."
  )
}

export const GET = POST
