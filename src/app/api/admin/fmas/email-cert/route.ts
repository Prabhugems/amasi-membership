import { Resend } from "resend"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"
import { FMAS_CERT_EMAIL_SUBJECT, buildFmasCertEmailHtml } from "@/lib/fmas-cert-email"

interface Body {
  amasi_number: number
  year?: number
  message?: string
}

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

  const db = createAdminClient()
  const { data: member, error: memberErr } = await db
    .from("members")
    .select("amasi_number, name, email")
    .eq("amasi_number", amasi)
    .maybeSingle()

  if (memberErr) {
    return Response.json({ error: memberErr.message }, { status: 500 })
  }
  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 })
  }
  if (!member.email) {
    return Response.json({ error: "Member has no email on file" }, { status: 400 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://membership.amasi.org"
  const certUrl = `${baseUrl}/member/fmas-certificate?id=${member.amasi_number}`
  const adminEmail =
    typeof admin.email === "string" ? admin.email : "admin@amasi.org"

  const resend = new Resend(process.env.RESEND_API_KEY?.trim())
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: member.email,
      subject: FMAS_CERT_EMAIL_SUBJECT,
      html: buildFmasCertEmailHtml({
        name: member.name ?? "Doctor",
        certUrl,
        message: body.message,
      }),
    })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to send email" },
      { status: 500 }
    )
  }

  await logAdminAction({
    adminEmail,
    adminName: typeof admin.name === "string" ? admin.name : undefined,
    action: "credential_email_sent",
    entityType: "member_credential",
    entityId: String(member.amasi_number),
    details: { credential_type: "FMAS", year: body.year ?? null, to: member.email },
  })

  return Response.json({ ok: true, sent_to: member.email })
}
