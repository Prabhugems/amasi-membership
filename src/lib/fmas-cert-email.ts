import { escapeHtml } from "@/lib/html-escape"

export const FMAS_CERT_EMAIL_SUBJECT = "Your AMASI FMAS Certificate"

// Shared by the single-send admin action (email-cert/route.ts) and the bulk
// sender (bulk-fmas-cert-email.ts) so the copy can't drift between the two —
// see AGENTS.md "Application → member field copy" fragile-area pattern for
// why duplicated builders are a recurring bug source in this codebase.
export function buildFmasCertEmailHtml(params: {
  name: string
  certUrl: string
  message?: string | null
}): string {
  const safeName = escapeHtml(params.name)
  const safeMessage = params.message ? escapeHtml(params.message) : null
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #b45309; margin: 0 0 12px;">Your FMAS Certificate</h2>
      <p style="color: #334155; font-size: 14px;">Dear ${safeName},</p>
      <p style="color: #334155; font-size: 14px;">
        Congratulations on completing your Fellowship in Minimal Access Surgery (FMAS).
        You can view and download your certificate using the link below.
      </p>
      ${safeMessage ? `<div style="background: #fef3c7; border-left: 3px solid #f59e0b; padding: 12px 16px; margin: 16px 0; color: #78350f; font-size: 14px; white-space: pre-wrap;">${safeMessage}</div>` : ""}
      <p style="margin: 24px 0;">
        <a href="${params.certUrl}" style="background: #b45309; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-size: 14px; display: inline-block;">
          View certificate
        </a>
      </p>
      <p style="color: #64748b; font-size: 12px;">
        Direct link: <a href="${params.certUrl}" style="color: #b45309;">${params.certUrl}</a>
      </p>
      <hr style="border: none; border-top: 1px solid #e5e5e5; margin: 24px 0;" />
      <p style="color: #94a3b8; font-size: 11px; text-align: center;">
        Association of Minimal Access Surgeons of India
      </p>
    </div>
  `
}
