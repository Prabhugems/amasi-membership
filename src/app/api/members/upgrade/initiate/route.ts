import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { sendMemberApprovedWhatsApp } from "@/lib/whatsapp"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

// Admin-initiated ALM → LM upgrade. Skips the member-submitted flow entirely:
// no ASI cert OCR, no AI scoring, no pending_review queue. Admin trust is the
// authorization signal. Creates a `membership_upgrades` row pre-approved so
// the audit trail matches member-submitted upgrades that were later approved.
//
// Companion to POST /api/members/upgrade (member-submitted) and
// PATCH /api/members/upgrade/[id] (admin review of member-submitted requests).

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const { memberId, amasiNumber, asiMembershipNo, asiState } = body as {
      memberId?: string
      amasiNumber?: string | number
      asiMembershipNo?: string
      asiState?: string | null
    }

    if (!asiMembershipNo || !asiMembershipNo.trim()) {
      return Response.json({ status: false, message: "ASI membership number is required" }, { status: 400 })
    }
    if (!memberId && !amasiNumber) {
      return Response.json({ status: false, message: "memberId or amasiNumber is required" }, { status: 400 })
    }

    const supabase = createAdminClient()

    interface MemberRecord {
      id: string
      amasi_number: number
      name: string
      email: string
      phone: number | null
      membership_type: string
    }

    // Resolve the member — id first, fall back to amasi_number.
    let member: MemberRecord | null = null

    if (memberId) {
      const { data } = await supabase
        .from("members")
        .select("id, amasi_number, name, email, phone, membership_type")
        .eq("id", memberId)
        .maybeSingle()
      member = (data as MemberRecord | null) ?? null
    }
    if (!member && amasiNumber) {
      const asNum = typeof amasiNumber === "number" ? amasiNumber : parseInt(String(amasiNumber), 10)
      if (!Number.isNaN(asNum)) {
        const { data } = await supabase
          .from("members")
          .select("id, amasi_number, name, email, phone, membership_type")
          .eq("amasi_number", asNum)
          .maybeSingle()
        member = (data as MemberRecord | null) ?? null
      }
    }

    if (!member) {
      return Response.json({ status: false, message: "Member not found" }, { status: 404 })
    }

    const memberType = (member.membership_type || "").toUpperCase()
    const isALM = memberType === "ALM" || memberType.includes("ASSOCIATE LIFE")
    if (!isALM) {
      return Response.json(
        { status: false, message: `Member is ${member.membership_type || "(unknown)"}, not ALM. Only ALM members can be upgraded to LM here.` },
        { status: 400 }
      )
    }

    // Block duplicates against an in-flight or already-approved upgrade.
    const { data: existing } = await supabase
      .from("membership_upgrades")
      .select("id, status")
      .eq("member_id", member.id)
      .in("status", ["pending", "pending_review", "approved"])
      .limit(1)
    if (existing && existing.length > 0) {
      const s = existing[0].status
      if (s === "approved") {
        return Response.json({ status: false, message: "This member has already been upgraded" }, { status: 400 })
      }
      return Response.json(
        { status: false, message: "This member already has a pending upgrade request — review it in the queue instead" },
        { status: 400 }
      )
    }

    const asiTrim = asiMembershipNo.trim()
    const asiStateTrim = asiState?.trim() || null
    const adminEmail = (session.email as string) || "unknown"

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const code = Math.random().toString(36).substring(2, 6).toUpperCase()
    const upgradeNumber = `UPG-${date}-${code}`
    const nowIso = new Date().toISOString()

    // Insert pre-approved upgrade row. ai_verified=false + ai_confidence=null
    // distinguish admin-initiated from member-submitted auto-approves; the
    // review_notes string carries the actor identity.
    const { data: upgrade, error: insertError } = await supabase
      .from("membership_upgrades")
      .insert({
        upgrade_number: upgradeNumber,
        member_id: member.id,
        amasi_number: member.amasi_number,
        member_name: member.name,
        member_email: member.email,
        from_type: "ALM",
        to_type: "LM",
        asi_membership_no: asiTrim,
        asi_state: asiStateTrim,
        ai_verified: false,
        ai_confidence: null,
        status: "approved",
        review_notes: `Admin-initiated upgrade by ${adminEmail}`,
        reviewed_at: nowIso,
      })
      .select()
      .single()

    if (insertError || !upgrade) {
      Sentry.captureException(insertError, {
        tags: { route: "members/upgrade/initiate", op: "insert" },
        extra: { memberId: member.id, amasiNumber: member.amasi_number },
      })
      return Response.json({ status: false, message: "Failed to record upgrade" }, { status: 500 })
    }

    // Flip the member to LM.
    const { error: memberUpdateError } = await supabase
      .from("members")
      .update({
        membership_type: "LM",
        asi_membership_no: asiTrim,
        asi_state: asiStateTrim,
        voting_eligible: true,
        updated_at: nowIso,
      })
      .eq("id", member.id)

    if (memberUpdateError) {
      // Roll the upgrade row back so the queue doesn't show a phantom approval.
      await supabase.from("membership_upgrades").delete().eq("id", upgrade.id)
      Sentry.captureException(memberUpdateError, {
        tags: { route: "members/upgrade/initiate", op: "member-update" },
        extra: { memberId: member.id, upgradeId: upgrade.id },
      })
      return Response.json({ status: false, message: "Failed to update member record" }, { status: 500 })
    }

    // Approval email — mirrors the member-submitted auto-approve copy.
    try {
      const resend = getResend()
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: member.email,
        subject: `AMASI Membership Upgraded to Life Member`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
              <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
            </div>
            <h2 style="color: #1a1a1a;">Membership Upgraded!</h2>
            <p style="color: #555;">Dear ${escapeHtml(member.name)},</p>
            <p style="color: #555;">Your AMASI membership has been upgraded from <strong>Associate Life Member (ALM)</strong> to <strong>Life Member (LM)</strong>.</p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Membership Status</p>
              <p style="font-size: 24px; font-weight: bold; color: #0f766e; margin: 0;">Life Member (LM)</p>
              <p style="color: #666; font-size: 13px; margin: 8px 0 0;">AMASI #${escapeHtml(String(member.amasi_number))}</p>
            </div>
            <p style="color: #555; font-size: 14px;">You are now eligible for voting rights and all Life Member benefits.</p>
            <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
            <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
          </div>
        `,
      })
    } catch (emailErr) {
      console.error("Initiate-upgrade email error:", emailErr)
    }

    // WhatsApp.
    try {
      if (member.phone) {
        const phone = String(member.phone).replace(/\D/g, "")
        if (phone.length >= 10) {
          await sendMemberApprovedWhatsApp(phone, member.name, "Life Member", String(member.amasi_number))
        }
      }
    } catch (whatsappErr) {
      console.error("Initiate-upgrade WhatsApp error:", whatsappErr)
    }

    await logAdminAction({
      adminEmail,
      adminName: (session.name as string) || undefined,
      action: "initiate_upgrade",
      entityType: "upgrade",
      entityId: upgrade.id,
      entityName: member.name,
      details: { fromType: "ALM", toType: "LM", amasiNumber: member.amasi_number, asiMembershipNo: asiTrim },
    })

    return Response.json({
      status: true,
      message: `${member.name} upgraded to Life Member.`,
      upgrade,
    })
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    Sentry.captureException(err, { tags: { route: "members/upgrade/initiate" } })
    return Response.json({ status: false, message: err.message || "Failed to initiate upgrade" }, { status: 500 })
  }
}
