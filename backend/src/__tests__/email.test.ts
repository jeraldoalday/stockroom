// lib/env.ts and lib/email.ts both read process.env at module load time
// (buildSmtpConfig / buildEmailSender), so exercising both branches means
// re-requiring them fresh with different env vars each time rather than
// importing once at the top of the file the way every other test here does.
const sendMail = jest.fn().mockResolvedValue(undefined);
const createTransport = jest.fn((..._args: unknown[]) => ({ sendMail }));

jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: (...args: unknown[]) => createTransport(...args) },
}));

async function loadEmailModule(smtpEnv: Record<string, string | undefined>) {
  jest.resetModules();
  const previous = { ...process.env };
  for (const [key, value] of Object.entries(smtpEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await import("../lib/email");
  } finally {
    process.env = previous;
  }
}

describe("emailSender", () => {
  const consoleSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);

  afterEach(() => {
    consoleSpy.mockClear();
    sendMail.mockClear();
    createTransport.mockClear();
  });

  it("falls back to logging when SMTP_HOST is unset", async () => {
    const { emailSender } = await loadEmailModule({ SMTP_HOST: undefined });
    await emailSender.send({ to: "a@b.test", subject: "Hi", text: "Body" });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("to=a@b.test"));
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("sends through SMTP once SMTP_HOST is set", async () => {
    const { emailSender } = await loadEmailModule({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "2525",
      SMTP_SECURE: "true",
      SMTP_USER: "apikey",
      SMTP_PASS: "secret",
      SMTP_FROM: "StockRoom <no-reply@example.com>",
    });
    await emailSender.send({ to: "a@b.test", subject: "Hi", text: "Body" });

    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ host: "smtp.example.com", port: 2525, secure: true, auth: { user: "apikey", pass: "secret" } })
    );
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: "StockRoom <no-reply@example.com>", to: "a@b.test", subject: "Hi", text: "Body" })
    );
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("omits auth when no SMTP_USER is configured", async () => {
    const { emailSender } = await loadEmailModule({ SMTP_HOST: "smtp.example.com", SMTP_USER: undefined, SMTP_PASS: undefined });
    await emailSender.send({ to: "a@b.test", subject: "Hi", text: "Body" });

    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ auth: undefined }));
  });
});
