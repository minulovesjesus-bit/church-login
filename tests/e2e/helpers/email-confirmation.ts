import { execFileSync } from "node:child_process";

import { expect, type APIRequestContext } from "@playwright/test";

export const confirmationFixture = {
  email: "email-confirmation.student@example.test",
  password: "Confirmation-e2e-2026!",
} as const;

type MailRecipient = { Address?: string };
type MailSummary = { ID?: string; To?: MailRecipient[] };
type Mailbox = { messages?: MailSummary[] };
type MailMessage = { HTML?: string; Text?: string };

function loopbackUrl(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`Identity email-confirmation fixture requires ${name}.`);
  const parsed = new URL(value);
  if (
    !["http:", "https:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
  ) {
    throw new Error("Identity email-confirmation fixture requires loopback-only endpoints.");
  }
  return parsed;
}

function localMailboxUrl(): URL {
  if (process.env.APP_ENV !== "test") {
    throw new Error("Identity email-confirmation fixture requires APP_ENV=test.");
  }
  if ("VERCEL" in process.env || "VERCEL_ENV" in process.env) {
    throw new Error("Identity email-confirmation fixture cannot run on Vercel.");
  }
  loopbackUrl("SUPABASE_URL");
  return loopbackUrl("INBUCKET_URL");
}

export function cleanupEmailConfirmationFixture(): void {
  localMailboxUrl();
  execFileSync(
    "uv",
    [
      "run",
      "python",
      "tests/e2e/fixtures/email_confirmation.py",
      "cleanup",
      confirmationFixture.email,
    ],
    { env: process.env, stdio: ["ignore", "ignore", "pipe"] },
  );
}

function confirmationUrlFrom(message: MailMessage): URL | undefined {
  const content = `${message.HTML ?? ""}\n${message.Text ?? ""}`.replaceAll("&amp;", "&");
  const matched = content.match(/https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+/);
  if (!matched) return undefined;
  const url = new URL(matched[0]);
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) return undefined;
  const redirect = url.searchParams.get("redirect_to");
  if (redirect) {
    const redirectUrl = new URL(redirect);
    if (!["127.0.0.1", "localhost", "::1"].includes(redirectUrl.hostname)) return undefined;
  }
  return url;
}

export async function waitForEmailConfirmationUrl(
  request: APIRequestContext,
): Promise<URL> {
  const mailboxUrl = localMailboxUrl();
  let messageId = "";
  await expect.poll(async () => {
    const response = await request.get(new URL("/api/v1/messages", mailboxUrl).toString());
    expect(response.ok()).toBe(true);
    const mailbox = await response.json() as Mailbox;
    messageId = mailbox.messages?.find((message) => (
      message.To?.some((recipient) => recipient.Address === confirmationFixture.email)
    ))?.ID ?? "";
    return messageId;
  }, { timeout: 15_000 }).not.toBe("");

  const response = await request.get(
    new URL(`/api/v1/message/${encodeURIComponent(messageId)}`, mailboxUrl).toString(),
  );
  expect(response.ok()).toBe(true);
  const confirmationUrl = confirmationUrlFrom(await response.json() as MailMessage);
  expect(confirmationUrl, "The local confirmation email must contain a loopback verification URL.").toBeDefined();
  return confirmationUrl!;
}
