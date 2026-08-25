import request from "supertest";
import type { Express } from "express";
import { emailSender } from "../../lib/email";

// The invite route (users.routes.ts) no longer lets an Owner choose the new
// member's password — it creates the account locked and emails a one-time
// `/reset-password` link, same shape as forgot-password. Tests that need a
// logged-in Staff user still need a known password, so this spies on the
// (console-logging, in tests) EmailSender just long enough to pull the token
// back out of the message it would have sent, then spends it through the
// real reset-password endpoint to land on a password the test chose.
export async function inviteAndSetPassword(
  app: Express,
  ownerToken: string,
  opts: { email: string; password: string; name?: string; role?: "OWNER" | "STAFF" }
) {
  const spy = jest.spyOn(emailSender, "send").mockResolvedValue(undefined);
  try {
    const invite = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${ownerToken}`)
      .send({ name: opts.name ?? "Clerk", email: opts.email, role: opts.role ?? "STAFF" });

    if (invite.status !== 201) {
      return invite;
    }

    const sent = spy.mock.calls.find(([message]) => message.to === opts.email.toLowerCase());
    const token = sent?.[0].text.match(/token=([a-f0-9]+)/)?.[1];
    if (!token) {
      throw new Error("invite email did not contain a reset token");
    }

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({ token, newPassword: opts.password });
    if (reset.status !== 204) {
      throw new Error(`failed to set the invited user's password: ${reset.status} ${JSON.stringify(reset.body)}`);
    }

    return invite;
  } finally {
    spy.mockRestore();
  }
}
