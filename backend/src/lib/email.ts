import nodemailer from "nodemailer";
import { env } from "./env";

// The seam a real transactional-email path plugs into. Implement
// EmailSender and swap `emailSender` below; nothing calling send() needs to
// change. `SmtpEmailSender` is deliberately generic SMTP rather than a named
// provider's own SDK — SendGrid, Postmark, SES, and Mailgun all speak SMTP
// as well as their own API, so one implementation covers any of them
// without betting this codebase on a specific vendor's client library. Set
// `SMTP_HOST` (see `.env.example`) to switch it on; unset, this falls back
// to logging the message so local dev and demos can read reset/invite links
// straight out of the server console, same as before.
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(
      `[email:dev] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`
    );
  }
}

class SmtpEmailSender implements EmailSender {
  private transport: ReturnType<typeof nodemailer.createTransport>;
  private from: string;

  constructor(config: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }) {
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.user ? { user: config.user, pass: config.pass } : undefined,
    });
    this.from = config.from;
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

function buildEmailSender(): EmailSender {
  if (!env.smtp) {
    return new ConsoleEmailSender();
  }
  return new SmtpEmailSender(env.smtp);
}

export const emailSender: EmailSender = buildEmailSender();
