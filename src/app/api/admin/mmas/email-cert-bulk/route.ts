import { NextRequest } from "next/server"
import { getAdminSession } from "@/lib/auth"
import { countEligibleFmasCertEmails, sendNextFmasCertEmailBatch } from "@/lib/bulk-fmas-cert-email"

export async function GET(request: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const year = Number(request.nextUrl.searchParams.get("year"))
  if (!Number.isInteger(year)) {
    return Response.json({ error: "year is required" }, { status: 400 })
  }

  const eligibleCount = await countEligibleFmasCertEmails("MMAS", year)
  return Response.json({ status: true, eligible_count: eligibleCount })
}

export async function POST(request: NextRequest) {
  const admin = await getAdminSession()
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const year = Number(body.year)
  if (!Number.isInteger(year)) {
    return Response.json({ error: "year is required" }, { status: 400 })
  }
  const batchSize = typeof body.batchSize === "number" ? body.batchSize : undefined
  const actorEmail = typeof admin.email === "string" ? admin.email : "admin@amasi.org"

  try {
    const result = await sendNextFmasCertEmailBatch(actorEmail, { credentialType: "MMAS", year, batchSize })
    return Response.json({ status: true, ...result })
  } catch (err) {
    console.error("[admin mmas email-cert-bulk]", err)
    return Response.json(
      { status: false, message: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    )
  }
}
