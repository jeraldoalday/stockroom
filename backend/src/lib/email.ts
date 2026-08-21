// No transactional email provider is configured anywhere in this stack
// (no SMTP/API key in any .env.example, nothing in the PRD's env list) —
// same gap noted since Day 13's invite flow and Day 15's password-change
// entry in docs/PROGRESS.md. This interface is the seam a real provider
// (SendGrid/Postmark/SES/...) plugs into later: implement EmailSender and
// swap the `emailSender` export below, and nothing calling send() needs to
// change. Until then, ConsoleEmailSender logs the message so local dev and
// demos can read reset links straight out of the server console.
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

export const emailSender: EmailSender = new ConsoleEmailSender();
