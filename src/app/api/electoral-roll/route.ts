// @auth: public — masked-PII electoral roll for members ahead of an election;
// emails/phones are masked in the response (admin surface for the full roll
// lives under /api/admin/electoral-roll/*). Rate-limited per IP.
import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { checkRateLimit } from "@/lib/rate-limit"

// First 3 chars of the local part + "***" + last 3 chars + domain.
// "prabhu3693gems@gmail.com" → "pra***ems@gmail.com". Short locals (≤ 6
// chars) drop to first-1 + *** + last-1 so the mask doesn't reveal the
// whole address. Members can still recognise their own row from the
// visible tail.
//
// `@noemail.amasi.org` is the internal placeholder used during legacy
// imports when no real email existed (907 LM rows as of 2026-05-21).
// Return null for those so the UI shows "—" rather than a fake masked
// value that looks real.
function maskEmail(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.includes("@")) return null
  if (/@noemail\.amasi\.org$/i.test(raw.trim())) return null
  const [local, domain] = raw.split("@", 2)
  if (!local || !domain) return null
  if (local.length <= 6) {
    return `${local.slice(0, 1)}***${local.slice(-1)}@${domain}`
  }
  return `${local.slice(0, 3)}***${local.slice(-3)}@${domain}`
}

// First 3 digits + "***" + last 3 digits. "9876543210" → "987***210".
// Members can recognise their own row from the last 3; harvesters can't
// reconstruct the full number. Non-digits are stripped first so values
// like "+91 9876543210" still produce a meaningful mask.
function maskPhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const digits = String(raw).replace(/\D/g, "")
  if (digits.length < 6) return null
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`
}

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 100

export async function GET(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown"
  const rl = await checkRateLimit(`electoral-roll:${ip}`, 60, 15 * 60 * 1000)
  if (!rl.allowed) {
    return Response.json(
      { status: false, message: "Too many requests. Please try again later.", data: [], count: 0 },
      { status: 429 }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const q = searchParams.get("q")?.trim() || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
  const pageSize = Math.min(
    PAGE_SIZE_MAX,
    Math.max(1, parseInt(searchParams.get("pageSize") || String(PAGE_SIZE_DEFAULT)) || PAGE_SIZE_DEFAULT)
  )
  const offset = (page - 1) * pageSize

  try {
    const supabase = createAdminClient()

    let query = supabase
      .from("members")
      .select(
        "amasi_number, salutation, name, city, state, email, phone, mobile_code",
        { count: "exact" }
      )
      .eq("membership_type", "LM")
      .eq("status", "active")
      .eq("voting_eligible", true)

    if (q) {
      const asNum = parseInt(q, 10)
      if (!isNaN(asNum) && /^\d+$/.test(q)) {
        query = query.or(`amasi_number.eq.${asNum},name.ilike.%${q}%`)
      } else {
        query = query.ilike("name", `%${q}%`)
      }
    }

    query = query
      .order("amasi_number", { ascending: true })
      .range(offset, offset + pageSize - 1)

    const { data, count, error } = await query

    if (error) {
      console.error("Electoral roll query error:", error)
      return Response.json(
        { status: false, message: "Failed to load electoral roll", data: [], count: 0 },
        { status: 500 }
      )
    }

    const rows = (data || []) as unknown as Array<Record<string, unknown>>

    return Response.json({
      status: true,
      data: rows.map((m) => ({
        amasi_number: m.amasi_number,
        name: [m.salutation, m.name].filter((p) => typeof p === "string" && p).join(" ").trim() || m.name,
        city: m.city || null,
        state: m.state || null,
        email_masked: maskEmail(m.email),
        phone_masked: maskPhone(m.phone),
      })),
      count: count || 0,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil((count || 0) / pageSize)),
    })
  } catch (error: unknown) {
    console.error("Electoral roll error:", error)
    return Response.json(
      { status: false, message: "Failed to load electoral roll", data: [], count: 0 },
      { status: 500 }
    )
  }
}
