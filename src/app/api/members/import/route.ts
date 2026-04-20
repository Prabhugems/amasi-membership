import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"

const MAX_ROWS = 500

const REQUIRED_FIELDS = ["name", "email", "membership_type"] as const

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []

  // Parse header row
  const headers = parseLine(lines[0]).map((h) =>
    h.trim().toLowerCase().replace(/\s+/g, "_")
  )

  const rows: Record<string, string>[] = []
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i])
    const row: Record<string, string> = {}
    headers.forEach((h, idx) => {
      row[h] = (values[idx] || "").trim()
    })
    rows.push(row)
  }
  return rows
}

/** Simple RFC 4180-aware CSV line parser */
function parseLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"'
          i++ // skip escaped quote
        } else {
          inQuotes = false
        }
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ",") {
        result.push(current)
        current = ""
      } else {
        current += ch
      }
    }
  }
  result.push(current)
  return result
}

export async function POST(request: NextRequest) {
  try {
    const session = await getAdminSession()
    if (!session) {
      return Response.json({ error: "Unauthorized" }, { status: 401 })
    }

    // super_admin only
    if (session.adminRole !== "super_admin") {
      return Response.json(
        { error: "Forbidden — super admin only" },
        { status: 403 }
      )
    }

    const formData = await request.formData()
    const file = formData.get("file") as File | null

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 })
    }

    if (!file.name.endsWith(".csv")) {
      return Response.json(
        { error: "Only CSV files are accepted" },
        { status: 400 }
      )
    }

    const text = await file.text()
    const rows = parseCSV(text)

    if (rows.length === 0) {
      return Response.json(
        { error: "CSV file is empty or has no data rows" },
        { status: 400 }
      )
    }

    if (rows.length > MAX_ROWS) {
      return Response.json(
        {
          error: `CSV exceeds the maximum of ${MAX_ROWS} rows. Got ${rows.length} rows.`,
        },
        { status: 400 }
      )
    }

    const supabase = createAdminClient()

    // Collect existing emails for duplicate detection
    const emails = rows
      .map((r) => (r.email || "").toLowerCase())
      .filter(Boolean)

    const existingEmails = new Set<string>()

    // Batch lookup in groups of 100
    for (let i = 0; i < emails.length; i += 100) {
      const batch = emails.slice(i, i + 100)
      const { data } = await supabase
        .from("members")
        .select("email")
        .in("email", batch)
      if (data) {
        data.forEach((d: any) => existingEmails.add(d.email?.toLowerCase()))
      }
    }

    const errors: string[] = []
    const toInsert: Record<string, any>[] = []
    let skipped = 0

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2 // +2 because row 1 is header, data starts at row 2

      // Validate required fields
      const missing = REQUIRED_FIELDS.filter((f) => !row[f])
      if (missing.length > 0) {
        errors.push(`Row ${rowNum}: missing required fields: ${missing.join(", ")}`)
        continue
      }

      const email = row.email.toLowerCase()

      // Skip duplicates
      if (existingEmails.has(email)) {
        skipped++
        continue
      }

      // Mark as seen to skip duplicate rows within the same CSV
      existingEmails.add(email)

      toInsert.push({
        name: row.name,
        email,
        phone: row.phone || null,
        membership_type: row.membership_type,
        zone: row.zone || null,
        state: row.state || null,
        city: row.city || null,
        joining_date: row.joining_date || null,
        pg_degree: row.pg_degree || null,
        mci_council_number: row.mci_council_number || null,
        is_active: row.is_active ? row.is_active.toLowerCase() === "true" : true,
        status: "active",
      })
    }

    let imported = 0

    // Insert in batches of 100
    for (let i = 0; i < toInsert.length; i += 100) {
      const batch = toInsert.slice(i, i + 100)
      const { error, count } = await supabase
        .from("members")
        .insert(batch)
        .select("email")

      if (error) {
        console.error("Import insert error:", error)
        errors.push(
          `Batch ${Math.floor(i / 100) + 1}: database insert failed — ${error.message}`
        )
      } else {
        imported += batch.length
      }
    }

    return Response.json({
      imported,
      skipped,
      errors,
    })
  } catch (error: any) {
    console.error("Import error:", error)
    return Response.json({ error: "Import failed" }, { status: 500 })
  }
}
