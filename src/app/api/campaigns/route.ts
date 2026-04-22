import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { Resend } from "resend"
import { escapeHtml } from "@/lib/html-escape"

const resend = new Resend(process.env.RESEND_API_KEY)
const fromEmail = process.env.RESEND_FROM_EMAIL || "AMASI <noreply@amasi.org>"
const baseUrl = "https://membership.amasi.org"

// ---------------------------------------------------------------------------
// GET — list all campaigns from membership_audit_log
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from("membership_audit_log")
    .select("*")
    .eq("action", "campaign_sent")
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Each row's `details` JSONB contains: campaign, total, sent, failed, date, amasi_range
  const campaigns = (data ?? []).map((row: any) => ({
    id: row.id,
    campaign: row.details?.campaign ?? "Unknown Campaign",
    total: row.details?.total ?? 0,
    sent: row.details?.sent ?? 0,
    failed: row.details?.failed ?? 0,
    date: row.details?.date ?? row.created_at,
    amasi_range: row.details?.amasi_range ?? "",
    recipients: row.details?.recipients ?? [],
    created_at: row.created_at,
  }))

  // Aggregate stats
  const totalCampaigns = campaigns.length
  const totalEmailsSent = campaigns.reduce((sum: number, c: any) => sum + (c.sent || 0), 0)

  // Count members who updated their profile after the earliest campaign date
  let membersUpdated = 0
  if (campaigns.length > 0) {
    const earliestDate = campaigns[campaigns.length - 1]?.date
    if (earliestDate) {
      const { count } = await supabase
        .from("membership_audit_log")
        .select("*", { count: "exact", head: true })
        .eq("action", "profile_update")
        .gte("created_at", earliestDate)

      membersUpdated = count ?? 0
    }
  }

  return Response.json({
    campaigns,
    stats: { totalCampaigns, totalEmailsSent, membersUpdated },
  })
}

// ---------------------------------------------------------------------------
// POST — send a new profile-update campaign batch
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json().catch(() => ({}))
  if (body.action !== "send_profile_update") {
    return Response.json({ error: "Invalid action" }, { status: 400 })
  }

  const supabase = createAdminClient()

  // Get next 100 members missing PG degree with real emails
  const { data: members, error: fetchErr } = await supabase
    .from("members")
    .select("amasi_number, name, email, pg_degree, profile_photo, membership_type")
    .is("pg_degree", null)
    .not("email", "like", "noemail-%")
    .order("amasi_number", { ascending: false })
    .limit(100)

  if (fetchErr) {
    return Response.json({ error: fetchErr.message }, { status: 500 })
  }

  if (!members || members.length === 0) {
    return Response.json({ error: "No members found matching criteria" }, { status: 404 })
  }

  let sent = 0
  let failed = 0
  const recipients: Array<{
    email: string
    amasi_number: string
    name: string
    sent_at: string | null
    error?: string
  }> = []

  for (const m of members) {
    const rawName = m.name || "Member"
    const firstName = escapeHtml(rawName.split(" ")[0])
    const safeName = escapeHtml(rawName)
    const safeEmail = escapeHtml(m.email)

    const html = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%); padding: 32px 24px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 22px;">AMASI</h1>
        <p style="color: #ccfbf1; font-size: 13px; margin: 6px 0 0;">Association of Minimal Access Surgeons of India</p>
      </div>
      <div style="padding: 28px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px;">
        <p style="color: #374151; font-size: 15px;">Dear Dr. ${firstName},</p>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          We are updating our membership records and noticed that your profile is incomplete.
          Your AMASI membership number is <strong>#${escapeHtml(String(m.amasi_number))}</strong>.
        </p>
        <div style="background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <p style="color: #92400e; font-weight: bold; margin: 0 0 8px;">Please update the following:</p>
          <ol style="color: #92400e; font-size: 14px; margin: 0; padding-left: 20px; line-height: 1.8;">
            <li>PG Degree &amp; Specialisation</li>
            <li>Profile Photo (passport-size)</li>
            <li>Date of Birth</li>
            <li>Contact Number</li>
            <li>Address Details</li>
          </ol>
        </div>
        <p style="color: #555; font-size: 14px; line-height: 1.6;">
          An updated profile ensures you receive your digital membership card, certificate,
          and are eligible for AMASI events and courses like FMAS.
        </p>
        <div style="text-align: center; margin: 28px 0 16px;">
          <a href="${baseUrl}/member"
             style="display: inline-block; background: #0f766e; color: #ffffff; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-size: 14px; font-weight: 600;">
            Update My Profile
          </a>
        </div>
        <p style="color: #555; font-size: 13px;">
          Log in with your registered email <strong>${safeEmail}</strong> and verify via OTP.
        </p>
        <p style="color: #555; font-size: 13px;">If you have questions, contact us at <a href="mailto:support@amasi.org" style="color: #0f766e;">support@amasi.org</a>.</p>
        <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
        <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
      </div>
    </div>
    `

    try {
      await resend.emails.send({
        from: fromEmail,
        to: m.email,
        subject: `AMASI Member #${m.amasi_number} — Please Update Your Profile`,
        html,
      })
      sent++
      recipients.push({
        email: m.email,
        amasi_number: String(m.amasi_number),
        name: rawName,
        sent_at: new Date().toISOString(),
      })
    } catch (e: any) {
      failed++
      recipients.push({
        email: m.email,
        amasi_number: String(m.amasi_number),
        name: rawName,
        sent_at: null,
        error: e.message || "Send failed",
      })
    }

    // Rate limit: pause every 10 emails
    if (sent % 10 === 0) {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }

  const amasiRange = `${members[members.length - 1]?.amasi_number} to ${members[0]?.amasi_number}`

  // Log campaign to audit log
  try {
    await supabase.from("membership_audit_log").insert({
      action: "campaign_sent",
      target_type: "members",
      target_id: `profile_update_${Date.now()}`,
      details: {
        campaign: "Profile Update — Missing PG Degree",
        total: members.length,
        sent,
        failed,
        date: new Date().toISOString(),
        amasi_range: amasiRange,
        recipients,
      },
      performed_by: (session as any).email || "admin",
    })
  } catch (logErr) {
    console.error("Failed to log campaign:", logErr)
  }

  return Response.json({ sent, failed, range: amasiRange })
}
