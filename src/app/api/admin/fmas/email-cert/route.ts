import { Resend } from "resend"
import { getAdminSession } from "@/lib/auth"
import { createAdminClient } from "@/lib/supabase"
import { logAdminAction } from "@/lib/audit-log"

interface Body {
  amasi_number: number
  message?: string
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
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
  const safeName = escapeHtml(member.name ?? "Doctor")
  const safeMessage = body.message ? escapeHtml(body.message) : null
  const adminEmail =
    typeof admin.email === "string" ? admin.email : "admin@amasi.org"

  const resend = new Resend(process.env.RESEND_API_KEY?.trim())
  try {
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
      to: member.email,
      subject: "Your AMASI FMAS Certificate",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="color: #b45309; margin: 0 0 12px;">Your FMAS Certificate</h2>
          <p style="color: #334155; font-size: 14px;">Dear ${safeName},</p>
          <p style="color: #334155; font-size: 14px;">
            Congratulations on completing the Foundations of Minimal Access Surgery course.
            You can view and download your certificate using the link below.
          </p>
          ${safeMessage ? `<div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px 16px; margin: 16px 0; color: #78350f; font-size: 14px; white-space: pre-wrap;">${safeMessage}</div>` : ""}
          <p style="margin: 24px 0;">
            <a href="${certUrl}" style="background: #b45309; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; display: inline-block;">
              View certificate
            </a>
          </p>
          <p style="color: #64748b; font-size: 12px;">
            Direct link: <a href="${certUrl}" style="color: #b45309;">${certUrl}</a>
          </p>
          <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
          <p style="color: #94a3b8; font-size: 11px; text-align: center;">
            Association of Minimal Access Surgeons of India
          </p>
        </div>
      `,
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
    details: { credential_type: "FMAS", to: member.email },
  })

  return Response.json({ ok: true, sent_to: member.email })
}
