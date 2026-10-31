// Sends mail through whatever SMTP server SMTP_URL names. Off when it is not set.
import nodemailer from "nodemailer";

export const emailEnabled = () => !!process.env.SMTP_URL && !!process.env.EMAIL_FROM;

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const transport = nodemailer.createTransport(process.env.SMTP_URL!);
  await transport.sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
}
