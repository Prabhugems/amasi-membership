import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

const AMASI_API = "https://application.amasi.org/api/member_detail_data"

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { batchSize = 50, offset = 0 } = await request.json().catch(() => ({}))

  try {
    const supabase = createAdminClient()

    // Get members missing documents
    const { data: members, error } = await supabase
      .from("members")
      .select("id, amasi_number, email, name, profile_photo, pg_degree_certificate, mci_certificate, asi_member_certificate, mbbs_degree_certificate")
      .is("profile_photo", null)
      .is("pg_degree_certificate", null)
      .is("mci_certificate", null)
      .order("amasi_number", { ascending: true })
      .range(offset, offset + batchSize - 1)

    if (error || !members) {
      return Response.json({ error: error?.message || "Failed to fetch members" }, { status: 500 })
    }

    if (members.length === 0) {
      return Response.json({ status: true, message: "No more members to sync", synced: 0, total: 0 })
    }

    let synced = 0
    let skipped = 0
    const results: { amasi: number; name: string; status: string; docs: string[] }[] = []

    for (const member of members) {
      if (!member.email) {
        skipped++
        continue
      }

      try {
        // Fetch from old API
        const formData = new FormData()
        formData.append("email_or_phone", member.email)

        const res = await fetch(AMASI_API, { method: "POST", body: formData })
        const json = await res.json()

        if (!json.status || !json.data?.[0]) {
          skipped++
          results.push({ amasi: member.amasi_number, name: member.name, status: "not_found", docs: [] })
          continue
        }

        const old = json.data[0]
        const updates: Record<string, string | null> = {}
        const docsList: string[] = []

        // Map old API field names to our DB columns
        if (old.profile && !member.profile_photo) {
          updates.profile_photo = old.profile
          docsList.push("photo")
        }
        if (old.pg_degree_certificate && !member.pg_degree_certificate) {
          updates.pg_degree_certificate = old.pg_degree_certificate
          docsList.push("pg_cert")
        }
        if (old.mci_certificate && !member.mci_certificate) {
          updates.mci_certificate = old.mci_certificate
          docsList.push("mci_cert")
        }
        if (old.asi_member_certificate && !member.asi_member_certificate) {
          updates.asi_member_certificate = old.asi_member_certificate
          docsList.push("asi_cert")
        }
        if (old.mbbs_degree_certificate && !member.mbbs_degree_certificate) {
          updates.mbbs_degree_certificate = old.mbbs_degree_certificate
          docsList.push("mbbs_cert")
        }
        if (old.active_license) {
          updates.active_license = old.active_license
          docsList.push("license")
        }
        if (old.letter_hod) {
          updates.letter_hod = old.letter_hod
          docsList.push("hod_letter")
        }

        if (Object.keys(updates).length > 0) {
          updates.updated_at = new Date().toISOString()
          await supabase.from("members").update(updates).eq("id", member.id)
          synced++
          results.push({ amasi: member.amasi_number, name: member.name, status: "synced", docs: docsList })
        } else {
          skipped++
          results.push({ amasi: member.amasi_number, name: member.name, status: "no_docs_in_old", docs: [] })
        }
      } catch (err) {
        skipped++
        results.push({ amasi: member.amasi_number, name: member.name, status: "error", docs: [] })
      }

      // Small delay to avoid hammering the old API
      await new Promise(r => setTimeout(r, 200))
    }

    return Response.json({
      status: true,
      message: `Synced ${synced} members, skipped ${skipped}`,
      synced,
      skipped,
      batchSize: members.length,
      nextOffset: offset + batchSize,
      results,
    })
  } catch (error: unknown) {
    console.error("Sync error:", error)
    return Response.json({ error: "Sync failed" }, { status: 500 })
  }
}
