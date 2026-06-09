import { NextRequest } from "next/server"
import * as Sentry from "@sentry/nextjs"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { sendMemberApprovedWhatsApp } from "@/lib/whatsapp"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

// Admin-initiated membership conversion. Skips the member-submitted flow
// entirely: no ASI cert OCR, no AI scoring, no pending_review queue. Admin
// trust is the authorization signal. Creates a `membership_upgrades` row
// pre-approved so the audit trail matches member-submitted upgrades that
// were later approved.
//
// Supported transitions (extended 2026-06-09 for ACM, follow-up to 3d0dede):
//   - ALM → LM   (requires ASI membership no)
//   - ACM → LM   (requires ASI membership no)
//   - ACM → ALM  (no ASI required — qualified surgeon without ASI)
//
// LM and ILM cannot be upgraded via this route. Member-submitted POST
// /api/members/upgrade is still ALM → LM only.

type ToType = "LM" | "ALM"
type FromType = "ALM" | "ACM"

const TARGET_LABEL: Record<ToType, string> = {
  LM: "Life Member",
  ALM: "Associate Life Member",
}

const SOURCE_LABEL: Record<FromType, string> = {
  ALM: "Associate Life Member (ALM)",
  ACM: "Associate Candidate Member (ACM)",
}

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

// Classify the member's current type into one we can upgrade FROM. Accepts
// both shortcodes ("ALM") and the longform display values that some legacy
// rows carry ("Associate Life Member").
function classifyFromType(value: string | null | undefined): FromType | null {
  const v = (value || "").toUpperCase()
  if (!v) return null
  // ACM must be checked first — "ASSOCIATE CANDIDATE MEMBER" contains "ASSOCIATE"
  // but is NOT ALM. The ALM check guards against the same overlap.
  if (v === "ACM" || v.includes("CANDIDATE")) return "ACM"
  if (v === "ALM" || (v.includes("ASSOCIATE") && v.includes("LIFE"))) return "ALM"
  return null
}

// Allowed transitions. ALM → ALM and ACM → ACM are rejected as no-ops.
function isAllowedTransition(from: FromType, to: ToType): boolean {
  if (from === "ALM" && to === "LM") return true
  if (from === "ACM" && to === "LM") return true
  if (from === "ACM" && to === "ALM") return true
  return false
}

export async function POST(request: NextRequest) {
  const session = await getAdminSession()
  if (!session) {
    return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await request.json()
    const {
      memberId,
      amasiNumber,
      toType: rawToType,
      asiMembershipNo,
      asiState,
    } = body as {
      memberId?: string
      amasiNumber?: string | number
      toType?: string
      asiMembershipNo?: string
      asiState?: string | null
    }

    // Default toType to LM for backward compatibility with the original
    // ALM → LM contract that shipped in 3d0dede.
    const toType: ToType = rawToType === "ALM" ? "ALM" : "LM"

    if (!memberId && !amasiNumber) {
      return Response.json({ status: false, message: "memberId or amasiNumber is required" }, { status: 400 })
    }
    if (toType === "LM" && (!asiMembershipNo || !asiMembershipNo.trim())) {
      return Response.json({ status: false, message: "ASI membership number is required for Life Member" }, { status: 400 })
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

    const fromType = classifyFromType(member.membership_type)
    if (!fromType) {
      return Response.json(
        {
          status: false,
          message: `Member is ${member.membership_type || "(unknown)"}. Only ALM and ACM members can be upgraded here.`,
        },
        { status: 400 }
      )
    }
    if (!isAllowedTransition(fromType, toType)) {
      return Response.json(
        { status: false, message: `Cannot upgrade ${fromType} → ${toType}.` },
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

    const asiTrim = asiMembershipNo?.trim() || null
    const asiStateTrim = asiState?.trim() || null
    const adminEmail = (session.email as string) || "unknown"

    const date = new Date().toISOString().slice(0, 10).replace(/-/g, "")
    const code = Math.random().toString(36).substring(2, 6).toUpperCase()
    const upgradeNumber = `UPG-${date}-${code}`
    const nowIso = new Date().toISOString()

    // Insert pre-approved upgrade row. ai_verified=false + ai_confidence=null
    // distinguish admin-initiated from member-submitted auto-approves; the
    // review_notes string carries the actor identity and the transition.
    const { data: upgrade, error: insertError } = await supabase
      .from("membership_upgrades")
      .insert({
        upgrade_number: upgradeNumber,
        member_id: member.id,
        amasi_number: member.amasi_number,
        member_name: member.name,
        member_email: member.email,
        from_type: fromType,
        to_type: toType,
        asi_membership_no: asiTrim,
        asi_state: asiStateTrim,
        ai_verified: false,
        ai_confidence: null,
        status: "approved",
        review_notes: `Admin-initiated ${fromType} → ${toType} by ${adminEmail}`,
        reviewed_at: nowIso,
      })
      .select()
      .single()

    if (insertError || !upgrade) {
      Sentry.captureException(insertError, {
        tags: { route: "members/upgrade/initiate", op: "insert" },
        extra: { memberId: member.id, amasiNumber: member.amasi_number, fromType, toType },
      })
      return Response.json({ status: false, message: "Failed to record upgrade" }, { status: 500 })
    }

    // Flip the member to the target type. Voting rights are LM-only per the
    // bylaws (src/lib/membership-types.ts:59,79); explicitly setting
    // voting_eligible=false on the ACM → ALM path keeps the flag aligned with
    // tier even if a stale value was sitting on the row.
    const memberUpdate: Record<string, unknown> = {
      membership_type: toType,
      voting_eligible: toType === "LM",
      updated_at: nowIso,
    }
    if (toType === "LM" && asiTrim) {
      memberUpdate.asi_membership_no = asiTrim
      memberUpdate.asi_state = asiStateTrim
    }

    const { error: memberUpdateError } = await supabase
      .from("members")
      .update(memberUpdate)
      .eq("id", member.id)

    if (memberUpdateError) {
      // Roll the upgrade row back so the queue doesn't show a phantom approval.
      await supabase.from("membership_upgrades").delete().eq("id", upgrade.id)
      Sentry.captureException(memberUpdateError, {
        tags: { route: "members/upgrade/initiate", op: "member-update" },
        extra: { memberId: member.id, upgradeId: upgrade.id, fromType, toType },
      })
      return Response.json({ status: false, message: "Failed to update member record" }, { status: 500 })
    }

    const targetLabel = TARGET_LABEL[toType]
    const sourceLabel = SOURCE_LABEL[fromType]
    const votingLine =
      toType === "LM"
        ? `<p style="color: #555; font-size: 14px;">You are now eligible for voting rights and all Life Member benefits.</p>`
        : `<p style="color: #555; font-size: 14px;">Your Associate Life Member benefits are now active. You can convert to Life Member later by providing your ASI membership details.</p>`

    // Approval email.
    try {
      const resend = getResend()
      await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
        to: member.email,
        subject: `AMASI Membership Upgraded to ${targetLabel}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
            <div style="text-align: center; margin-bottom: 24px;">
              <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
              <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
            </div>
            <h2 style="color: #1a1a1a;">Membership Upgraded!</h2>
            <p style="color: #555;">Dear ${escapeHtml(member.name)},</p>
            <p style="color: #555;">Your AMASI membership has been upgraded from <strong>${escapeHtml(sourceLabel)}</strong> to <strong>${escapeHtml(targetLabel)} (${escapeHtml(toType)})</strong>.</p>
            <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
              <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Membership Status</p>
              <p style="font-size: 24px; font-weight: bold; color: #0f766e; margin: 0;">${escapeHtml(targetLabel)} (${escapeHtml(toType)})</p>
              <p style="color: #666; font-size: 13px; margin: 8px 0 0;">AMASI #${escapeHtml(String(member.amasi_number))}</p>
            </div>
            ${votingLine}
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
          await sendMemberApprovedWhatsApp(phone, member.name, targetLabel, String(member.amasi_number))
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
      details: {
        fromType,
        toType,
        amasiNumber: member.amasi_number,
        ...(asiTrim ? { asiMembershipNo: asiTrim } : {}),
      },
    })

    return Response.json({
      status: true,
      message: `${member.name} upgraded to ${targetLabel}.`,
      upgrade,
    })
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error))
    Sentry.captureException(err, { tags: { route: "members/upgrade/initiate" } })
    return Response.json({ status: false, message: err.message || "Failed to initiate upgrade" }, { status: 500 })
  }
}
