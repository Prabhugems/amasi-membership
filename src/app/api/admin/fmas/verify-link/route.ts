import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { signVerifyToken } from "@/lib/credentials/verify-token"
import { logAdminAction } from "@/lib/audit-log"

interface Body {
  amasi_number: number
  // expiresIn understood by jose: e.g. "30d", "1y"
  expiresIn?: string
}

const ALLOWED_EXPIRY = new Set(["7d", "30d", "90d", "1y"])

export async function POST(req: Request) {
  const admin = await getAdminSession()
  if (!admin) return Response.json({ error: "Unauthorized" }, { status: 401 })

  let body: Body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const amasi = Number(body.amasi_number)
  if (!Number.isInteger(amasi) || amasi <= 0) {
    return Response.json({ error: "amasi_number is required" }, { status: 400 })
  }

  const expiresIn = body.expiresIn && ALLOWED_EXPIRY.has(body.expiresIn) ? body.expiresIn : "30d"
  const adminEmail = typeof admin.email === "string" ? admin.email : "admin@amasi.org"

  // Verify the credential actually exists before issuing a token.
  const db = createAdminClient()
  const { data: cred, error } = await db
    .from("member_credentials")
    .select("amasi_number, credential_type, year")
    .eq("amasi_number", amasi)
    .eq("credential_type", "FMAS")
    .order("year", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  if (!cred) return Response.json({ error: "Credential not found" }, { status: 404 })

  const token = await signVerifyToken(
    { amasi: cred.amasi_number, type: "FMAS", iss: adminEmail },
    expiresIn
  )
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"
  const url = `${baseUrl}/v/${token}`

  await logAdminAction({
    adminEmail,
    adminName: typeof admin.name === "string" ? admin.name : undefined,
    action: "credential_verify_link_generated",
    entityType: "member_credential",
    entityId: String(cred.amasi_number),
    details: { credential_type: "FMAS", expiresIn },
  })

  return Response.json({ ok: true, url, expires_in: expiresIn })
}
