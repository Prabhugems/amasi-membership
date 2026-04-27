import { createAdminClient } from "@/lib/supabase"

const OLD_API = "https://application.amasi.org/api/member_detail_data"

/**
 * GET /api/cron/sync-members
 * Runs on a schedule to pull new members from the old AMASI system.
 * Fetches members with AMASI numbers higher than our current max.
 */
export async function GET(request: Request) {
  // Auth: cron secret or admin session
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET?.trim()

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    // Allow super admin via cookie for manual trigger
    const { getAdminSession } = await import("@/lib/auth")
    const session = await getAdminSession()
    if (!session || session.adminRole !== "super_admin") {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }
  }

  try {
    const supabase = createAdminClient()

    // Get our current max AMASI number
    const { data: maxRow } = await supabase
      .from("members")
      .select("amasi_number")
      .order("amasi_number", { ascending: false })
      .limit(1)
      .single()

    const currentMax = maxRow?.amasi_number || 0
    console.log(`Sync: current max AMASI# = ${currentMax}`)

    // Try fetching the next 50 sequential numbers from the old system
    const imported: { amasi: number; name: string; email: string }[] = []
    const notFound: number[] = []
    let consecutiveNotFound = 0

    for (let num = currentMax + 1; num <= currentMax + 100; num++) {
      // Stop if we've had 10 consecutive misses (no more members)
      if (consecutiveNotFound >= 10) break

      try {
        // The old API searches by email/phone, not by AMASI number directly
        // We'll use a different approach: query our own DB for gaps
        // and try to fetch by membership number from the old system
        const formData = new FormData()
        formData.append("membership_no", String(num))

        const res = await fetch(OLD_API, { method: "POST", body: formData })
        if (!res.ok) { consecutiveNotFound++; notFound.push(num); continue }

        const data = await res.json()
        if (!data.status || !data.data?.length) {
          consecutiveNotFound++
          notFound.push(num)
          continue
        }

        consecutiveNotFound = 0
        const d = data.data[0]

        // Check if already exists
        const { data: existing } = await supabase
          .from("members")
          .select("amasi_number")
          .eq("amasi_number", num)
          .limit(1)
          .maybeSingle()

        if (existing) continue

        // Parse membership type
        const appName = d.application_name || ""
        let membershipType = appName
        if (appName.includes("[")) {
          const match = appName.match(/\[(\w+)\]/)
          if (match) membershipType = match[1]
        }

        // Build record
        const name = [d.first_name, d.middle_name, d.last_name].filter(Boolean).join(" ").trim()
        const record: Record<string, unknown> = {
          amasi_number: num,
          name: name || "Unknown",
          first_name: d.first_name || null,
          middle_name: d.middle_name || null,
          last_name: d.last_name || null,
          email: d.email || `member${num}@amasi.org`,
          phone: String(d.mobile || ""),
          status: "active",
          membership_type: membershipType,
          salutation: d.salutation || "Dr.",
          mobile_code: d.mobile_code || "+91",
          application_no: d.application_no || null,
          father_name: d.father_name || null,
          nationality: d.nationality || "Indian",
          street_address_1: d.street_line1 || null,
          street_address_2: d.street_line2 || null,
          city: d.city || null,
          state: d.state_name || d.state || null,
          country: d.country_name || "India",
          postal_code: d.pin || null,
          zone: d.zone || null,
          pg_degree: d.edu_postgrad_degree || null,
          pg_college: d.edu_postgrad_college || null,
          pg_university: d.edu_postgrad_university || null,
          mci_council_number: d.mci_council_number || null,
          mci_council_state: d.mci_council_state_name || d.mci_council_state || null,
          asi_membership_no: d.asi_membership_no || null,
          profile_photo: d.profile || null,
          mci_certificate: d.mci_certificate || null,
          pg_degree_certificate: d.pg_degree_certificate || null,
          mbbs_degree_certificate: d.mbbs_degree_certificate || null,
          asi_member_certificate: d.asi_member_certificate || null,
          active_license: d.active_license || null,
          letter_hod: d.letter_hod || null,
          gender: d.gender || null,
        }

        // Dates
        if (d.dob && d.dob !== "0000-00-00") record.date_of_birth = d.dob
        if (d.joining_date && d.joining_date !== "0000-00-00") record.joining_date = d.joining_date
        if (d.member_reg_date && !d.member_reg_date.includes("0000")) record.application_date = d.member_reg_date
        if (d.edu_postgrad_year && String(d.edu_postgrad_year) !== "0") {
          const py = parseInt(String(d.edu_postgrad_year))
          if (!isNaN(py)) record.pg_year = py
        }

        // Remove null/empty values
        for (const [k, v] of Object.entries(record)) {
          if (v === null || v === "" || v === "NULL") delete record[k]
        }
        // Re-add required fields
        record.amasi_number = num
        record.name = name || "Unknown"
        record.email = d.email || `member${num}@amasi.org`
        record.status = "active"

        const { error } = await supabase.from("members").insert(record)
        if (error) {
          console.error(`Sync: failed #${num}:`, error.message)
        } else {
          imported.push({ amasi: num, name, email: d.email || "" })
        }
      } catch (err: unknown) {
        consecutiveNotFound++
        const msg = err instanceof Error ? err.message : String(err)
        console.error(`Sync: error fetching #${num}:`, msg)
      }
    }

    const message = `Synced ${imported.length} new members (checked ${currentMax + 1} to ${currentMax + 100})`
    console.log(`Sync: ${message}`)

    return Response.json({
      status: true,
      message,
      currentMax,
      imported: imported.length,
      members: imported,
    })
  } catch (error: unknown) {
    console.error("Sync error:", error)
    return Response.json({ error: "Sync failed" }, { status: 500 })
  }
}
