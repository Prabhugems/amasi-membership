import { escapeHtml } from "@/lib/html-escape"

export type EmailableCredentialType = "FMAS" | "MMAS"

// Full designation shown in the email body, and the URL segment under
// /member/ that renders each type's certificate page.
const CREDENTIAL_INFO: Record<EmailableCredentialType, { designation: string; certPath: string }> = {
  FMAS: { designation: "Fellowship in Minimal Access Surgery (FMAS)", certPath: "fmas-certificate" },
  MMAS: { designation: "Mastery in Minimal Access Surgery (MMAS)", certPath: "mmas-certificate" },
}

export function certEmailSubject(credentialType: EmailableCredentialType): string {
  return `Your AMASI ${credentialType} Certificate`
}

export function certPageUrl(credentialType: EmailableCredentialType, amasiNumber: number): string {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://membership.amasi.org"
  return `${baseUrl}/member/${CREDENTIAL_INFO[credentialType].certPath}?id=${amasiNumber}`
}

// Shared by the single-send admin action (email-cert/route.ts) and the bulk
// sender (bulk-fmas-cert-email.ts) so the copy can't drift between the two —
// see AGENTS.md "Application → member field copy" fragile-area pattern for
// why duplicated builders are a recurring bug source in this codebase.
export function buildCertEmailHtml(params: {
  credentialType: EmailableCredentialType
  name: string
  certUrl: string
  message?: string | null
}): string {
  const safeName = escapeHtml(params.name)
  const safeMessage = params.message ? escapeHtml(params.message) : null
  const { designation } = CREDENTIAL_INFO[params.credentialType]
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #b45309; margin: 0 0 12px;">Your ${params.credentialType} Certificate</h2>
      <p style="color: #334155; font-size: 14px;">Dear ${safeName},</p>
      <p style="color: #334155; font-size: 14px;">
        Congratulations on completing your ${designation}.
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
