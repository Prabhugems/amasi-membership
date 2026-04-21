import { readFileSync } from "fs";
import { Resend } from "resend";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const getEnv = (k) => {
  const re = new RegExp(k + '=["\']?([^"\'\\n]+)');
  const m = env.match(re);
  return m?.[1]?.trim();
};

const resend = new Resend(getEnv("RESEND_API_KEY"));

const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#0d9488,#0f766e);border-radius:12px 12px 0 0;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:700;letter-spacing:0.5px;">AMASI</h1>
              <p style="margin:6px 0 0;color:#ccfbf1;font-size:13px;letter-spacing:0.3px;">Association of Minimal Access Surgeons of India</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="background-color:#ffffff;padding:40px;border-radius:0 0 12px 12px;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
              <p style="margin:0 0 20px;font-size:16px;color:#1f2937;line-height:1.6;">Dear Dr. Vineeth Kumar R K,</p>

              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
                We received your payment of <strong>\u20B94,230</strong> for your <strong>Life Member (LM)</strong> application
                (Ref: <code style="background:#f0fdfa;color:#0d9488;padding:2px 6px;border-radius:4px;font-size:13px;">AMASI-2026-35A96A0C17</code>).
                However, due to a technical issue, your application details were not saved.
              </p>

              <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.7;">
                <strong>Your payment is safe and fully recorded.</strong> You will <strong>NOT</strong> be charged again.
              </p>

              <p style="margin:0 0 28px;font-size:15px;color:#374151;line-height:1.7;">
                Please click the button below to complete your application. You'll need to verify your email and re-upload your documents. The payment step will be automatically skipped.
              </p>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:0 0 28px;">
                    <a href="https://membership.amasi.org/apply"
                       style="display:inline-block;background:linear-gradient(135deg,#0d9488,#0f766e);color:#ffffff;text-decoration:none;padding:14px 36px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.3px;">
                      Complete Your Application
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#6b7280;line-height:1.6;">
                If you have any questions, please contact
                <a href="mailto:support@amasi.org" style="color:#0d9488;text-decoration:none;font-weight:500;">support@amasi.org</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.5;">
                Association of Minimal Access Surgeons of India
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const fromEmail = getEnv("RESEND_FROM_EMAIL") || "AMASI <noreply@amasi.org>";

console.log("Sending email...");
console.log("From:", fromEmail);
console.log("To: vineeth.kumar.rk@gmail.com");

const { data, error } = await resend.emails.send({
  from: fromEmail,
  to: "vineeth.kumar.rk@gmail.com",
  subject: "Action Required: Complete your AMASI membership application",
  html,
});

if (error) {
  console.error("Failed to send email:", error);
  process.exit(1);
} else {
  console.log("Email sent successfully!");
  console.log("Email ID:", data.id);
}
