import { NextRequest } from "next/server"
import { createAdminClient } from "@/lib/supabase"
import { getAdminSession } from "@/lib/auth"
import { logAdminAction } from "@/lib/audit-log"
import { sendMemberApprovedWhatsApp } from "@/lib/whatsapp"
import { escapeHtml } from "@/lib/html-escape"
import { Resend } from "resend"

function getResend() {
  const key = process.env.RESEND_API_KEY?.trim()
  if (!key) throw new Error("RESEND_API_KEY not configured")
  return new Resend(key)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!id) {
    return Response.json({ status: false, message: "Upgrade ID required" }, { status: 400 })
  }

  const session = await getAdminSession()
  if (!session) {
    return Response.json({ status: false, message: "Unauthorized" }, { status: 401 })
  }

  try {
    const { action, notes } = await request.json()

    if (!action || !["approve", "reject"].includes(action)) {
      return Response.json({ status: false, message: "Invalid action. Use 'approve' or 'reject'" }, { status: 400 })
    }

    const supabase = createAdminClient()

    // Fetch upgrade request
    const { data: upgrade, error: fetchError } = await supabase
      .from("membership_upgrades")
      .select("*")
      .eq("id", id)
      .single()

    if (fetchError || !upgrade) {
      return Response.json({ status: false, message: "Upgrade request not found" }, { status: 404 })
    }

    if (upgrade.status === "approved") {
      return Response.json({ status: false, message: "This upgrade has already been approved" }, { status: 400 })
    }

    if (upgrade.status === "rejected") {
      return Response.json({ status: false, message: "This upgrade has already been rejected" }, { status: 400 })
    }

    if (action === "approve") {
      // Update member to LM
      const { error: memberUpdateError } = await supabase
        .from("members")
        .update({
          membership_type: "LM",
          asi_membership_no: upgrade.asi_membership_no,
          asi_state: upgrade.asi_state || null,
          voting_eligible: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", upgrade.member_id)

      if (memberUpdateError) {
        console.error("Member update error on approve:", memberUpdateError)
        return Response.json({ status: false, message: "Failed to update member record" }, { status: 500 })
      }

      // Update upgrade record
      await supabase
        .from("membership_upgrades")
        .update({
          status: "approved",
          review_notes: notes || "Approved by admin",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)

      // Send approval email
      try {
        const resend = getResend()
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: upgrade.member_email,
          subject: `AMASI Membership Upgraded to Life Member`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
                <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
              </div>
              <h2 style="color: #1a1a1a;">Membership Upgraded!</h2>
              <p style="color: #555;">Dear ${upgrade.member_name},</p>
              <p style="color: #555;">Your AMASI membership has been upgraded from <strong>Associate Life Member (ALM)</strong> to <strong>Life Member (LM)</strong>.</p>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; text-align: center; margin: 24px 0;">
                <p style="color: #666; font-size: 13px; margin: 0 0 8px;">Membership Status</p>
                <p style="font-size: 24px; font-weight: bold; color: #0f766e; margin: 0;">Life Member (LM)</p>
                <p style="color: #666; font-size: 13px; margin: 8px 0 0;">AMASI #${upgrade.amasi_number}</p>
              </div>
              ${notes ? `<p style="color: #555; font-size: 14px;"><strong>Note:</strong> ${escapeHtml(notes)}</p>` : ""}
              <p style="color: #555; font-size: 14px;">You are now eligible for voting rights and all Life Member benefits.</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          `,
        })
      } catch (emailErr) {
        console.error("Upgrade approval email error:", emailErr)
      }

      // Send WhatsApp notification
      try {
        const { data: memberData } = await supabase.from("members").select("phone, amasi_number").eq("id", upgrade.member_id).single()
        if (memberData?.phone) {
          const phone = String(memberData.phone).replace(/\D/g, "")
          if (phone.length >= 10) {
            await sendMemberApprovedWhatsApp(phone, upgrade.member_name, "Life Member", String(memberData.amasi_number))
          }
        }
      } catch (whatsappErr) {
        console.error("Upgrade WhatsApp error:", whatsappErr)
      }

      // Audit log
      await logAdminAction({
        adminEmail: (session.email as string) || "unknown",
        adminName: (session.name as string) || undefined,
        action: "approve_upgrade",
        entityType: "upgrade",
        entityId: id,
        entityName: upgrade.member_name,
        details: { fromType: "ALM", toType: "LM", amasiNumber: upgrade.amasi_number },
      })

      return Response.json({
        status: true,
        message: `Upgrade approved. ${upgrade.member_name} is now a Life Member.`,
      })
    }

    if (action === "reject") {
      // Update upgrade record
      await supabase
        .from("membership_upgrades")
        .update({
          status: "rejected",
          review_notes: notes || "Rejected by admin",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id)

      // Send rejection email
      try {
        const resend = getResend()
        await resend.emails.send({
          from: process.env.RESEND_FROM_EMAIL?.trim() || "AMASI <noreply@amasi.org>",
          to: upgrade.member_email,
          subject: `AMASI Membership Upgrade Request - Action Required`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="color: #0f766e; margin: 0;">AMASI</h1>
                <p style="color: #666; font-size: 14px;">Association of Minimal Access Surgeons of India</p>
              </div>
              <h2 style="color: #1a1a1a;">Upgrade Request Update</h2>
              <p style="color: #555;">Dear ${upgrade.member_name},</p>
              <p style="color: #555;">Your request to upgrade from Associate Life Member (ALM) to Life Member (LM) could not be approved at this time.</p>
              ${notes ? `
              <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 20px; margin: 24px 0;">
                <p style="color: #991b1b; font-weight: bold; margin: 0 0 8px;">Reason</p>
                <p style="color: #dc2626; margin: 0;">${escapeHtml(notes)}</p>
              </div>
              ` : ""}
              <p style="color: #555; font-size: 14px;">You may resubmit your upgrade request with the correct documentation. If you have questions, please contact us through the Member Portal support system.</p>
              <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
              <p style="color: #999; font-size: 12px; text-align: center;">Association of Minimal Access Surgeons of India</p>
            </div>
          `,
        })
      } catch (emailErr) {
        console.error("Upgrade rejection email error:", emailErr)
      }

      // Audit log
      await logAdminAction({
        adminEmail: (session.email as string) || "unknown",
        adminName: (session.name as string) || undefined,
        action: "reject_upgrade",
        entityType: "upgrade",
        entityId: id,
        entityName: upgrade.member_name,
        details: { notes },
      })

      return Response.json({
        status: true,
        message: `Upgrade request rejected.`,
      })
    }

    return Response.json({ status: false, message: "Invalid action" }, { status: 400 })
  } catch (error: any) {
    console.error("Upgrade admin error:", error)
    return Response.json({ status: false, message: error.message || "Failed to process" }, { status: 500 })
  }
}
