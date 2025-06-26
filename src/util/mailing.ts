import nodemailer, { type Transporter } from "nodemailer";

let mailTransporter: Transporter | null = null;

function getMailTransporter(): Transporter | null {
  if (
    !mailTransporter &&
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SENDER_EMAIL &&
    process.env.SENDER_PASSWORD
  ) {
    mailTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT), // Typically 587 for TLS
      secure: Number(process.env.SMTP_PORT) === 465, // true for port 465
      auth: {
        user: process.env.SENDER_EMAIL,
        pass: process.env.SENDER_PASSWORD,
      },
    });
  }

  return mailTransporter;
}

const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL || "recipient@example.com";

export async function sendEmail(
  subject: string,
  text: string,
  recipient = RECIPIENT_EMAIL,
): Promise<void> {
  const transporter = getMailTransporter();
  if (transporter && recipient) {
    try {
      const info = await transporter.sendMail({
        from: `"Tesla Powerwall Scheduler" <${process.env.SENDER_EMAIL || "your_email@example.com"}>`,
        to: recipient,
        subject: subject,
        text: text,
      });
      logger.info(`Email sent: ${info.messageId}`);
    } catch (error) {
      logger.error("Email sending error:", error);
    }
  }
}
