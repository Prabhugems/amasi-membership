/**
 * Gallabox WhatsApp Template Sender
 * Sends WhatsApp messages via Gallabox API using pre-approved templates
 */

const GALLABOX_API_URL = "https://server.gallabox.com/devapi/messages/whatsapp"

function getConfig() {
  return {
    apiKey: (process.env.GALLABOX_API_KEY || "").trim(),
    apiSecret: (process.env.GALLABOX_API_SECRET || "").trim(),
    channelId: (process.env.GALLABOX_CHANNEL_ID || "").trim(),
  }
}

export async function sendTemplate(
  phone: string,
  recipientName: string,
  templateName: string,
  bodyValues: Record<string, string>
): Promise<{ success: boolean; error?: string }> {
  const config = getConfig()
  if (!config.apiKey || !config.apiSecret || !config.channelId) {
    return { success: false, error: "WhatsApp not configured" }
  }

  // Format phone: ensure 91 prefix for Indian numbers
  let formattedPhone = phone.replace(/[^0-9]/g, "")
  if (formattedPhone.length === 10) formattedPhone = "91" + formattedPhone

  try {
    const res = await fetch(GALLABOX_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
      },
      body: JSON.stringify({
        channelId: config.channelId,
        channelType: "whatsapp",
        recipient: { name: recipientName, phone: formattedPhone },
        whatsapp: {
          type: "template",
          template: { templateName, bodyValues },
        },
      }),
    })

    const result = await res.json()
    if (res.ok && result.id) {
      return { success: true }
    }
    return { success: false, error: result.message || "Failed to send" }
  } catch (err: any) {
    console.error("[WhatsApp] Send failed:", err.message)
    return { success: false, error: err.message }
  }
}

/**
 * Send "Application Submitted" WhatsApp
 * Template: application_submit_templeate
 * Variables: {{Name}}
 */
export async function sendApplicationSubmittedWhatsApp(phone: string, name: string) {
  return sendTemplate(phone, name, "application_submit_templeate", { Name: name })
}

/**
 * Send "Membership Approved" WhatsApp
 * Template: member_approve_template
 * Variables: {{Name}}, {{Membership_Type}}, {{Membership_Number}}
 */
export async function sendMemberApprovedWhatsApp(
  phone: string,
  name: string,
  membershipType: string,
  membershipNumber: string
) {
  return sendTemplate(phone, name, "member_approve_template", {
    Name: name,
    Membership_Type: membershipType,
    Membership_Number: membershipNumber,
  })
}

/**
 * Send "Payment Pending" WhatsApp
 * Template: application_payment_pending
 * Variables: {{Name}}, {{APP_ID}}, {{Date}}, {{Url}}
 */
export async function sendPaymentPendingWhatsApp(
  phone: string,
  name: string,
  appId: string,
  date: string,
  url: string
) {
  return sendTemplate(phone, name, "application_payment_pending", {
    Name: name,
    APP_ID: appId,
    Date: date,
    Url: url,
  })
}

/**
 * Send "Certificate Ready" WhatsApp
 * Template: amasi_certificate_template
 * Variables: {{Name}}, {{Link}}, {{Phone}}
 */
export async function sendCertificateReadyWhatsApp(
  phone: string,
  name: string,
  link: string,
  contactPhone: string = "+91 7358105244"
) {
  return sendTemplate(phone, name, "amasi_certificate_template", {
    Name: name,
    Link: link,
    Phone: contactPhone,
  })
}
