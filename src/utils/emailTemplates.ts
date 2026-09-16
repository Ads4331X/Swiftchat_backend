// message to send in email

export function createOtpText({
  username,
  otp,
}: {
  username: string;
  otp: string;
}) {
  const fullMessage = [
    `Hello ${username},`,
    "",
    "Your password reset code is:",
    otp,
    "",
    "This code expires in 5 minutes.",
    "If you didn't request this, you can safely ignore this email.",
    "",
    "Regards,",
    "Swiftchat",
  ].join("\n");

  return fullMessage;
}
export function createOtpHtml({
  username,
  otp,
}: {
  username: string;
  otp: string;
}) {
  const htmlMessage = `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #1f2937;">
        <h2 style="margin: 0 0 16px;">Hello ${username},</h2>
        <p style="font-size: 15px; line-height: 1.6; margin: 0 0 8px;">
          Your password reset code is:
        </p>
        <div style="background: #e6f4fe; border: 1px dashed #00a896; border-radius: 12px; padding: 16px; text-align: center; margin: 16px 0;">
          <span style="font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #008378;">${otp}</span>
        </div>
        <p style="font-size: 13px; color: #6b7280; line-height: 1.6; margin: 0 0 16px;">
          This code expires in <strong>5 minutes</strong>.
          If you didn't request this, you can safely ignore this email.
        </p>
        <p style="font-size: 13px; color: #6b7280; margin: 0;">Regards,<br/>Swiftchat</p>
      </div>
    `;
  return htmlMessage;
}
