import { expect, type BrowserContext } from "@playwright/test";
import { createClient, type Session } from "@supabase/supabase-js";

export const identityFixtures = {
  incompleteStudent: {
    id: "00000000-0000-4000-8000-000000000101",
    email: "incomplete.student@example.test",
  },
  completeStudent: {
    id: "00000000-0000-4000-8000-000000000102",
    email: "complete.student@example.test",
  },
  fullSystemStudent: {
    id: "00000000-0000-4000-8000-000000000103",
    email: "student@example.test",
  },
  pendingTeacher: {
    id: "00000000-0000-4000-8000-000000000201",
    email: "pending.teacher@example.test",
  },
  approvedTeacher: {
    id: "00000000-0000-4000-8000-000000000202",
    email: "approved.teacher@example.test",
  },
  fullSystemTeacher: {
    id: "00000000-0000-4000-8000-000000000203",
    email: "teacher@example.test",
  },
  admin: {
    id: "00000000-0000-4000-8000-000000000301",
    email: "admin.identity@example.test",
  },
} as const;

export const fixturePassword = "Identity-e2e-2026!";

function requireLocalTestEnvironment(): { url: string; publishableKey: string } {
  if (process.env.APP_ENV !== "test") {
    throw new Error("Identity browser fixtures require APP_ENV=test.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey || !["127.0.0.1", "localhost"].includes(new URL(url).hostname)) {
    throw new Error("Identity browser fixtures require the local Supabase stack.");
  }
  return { url, publishableKey };
}

function sessionCookieName(url: string): string {
  return `sb-${new URL(url).hostname.split(".")[0]}-auth-token`;
}

function expiredAccessToken(accessToken: string): string {
  const [header, payload, signature] = accessToken.split(".");
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  return [
    header,
    Buffer.from(JSON.stringify({ ...claims, exp: 1 })).toString("base64url"),
    signature,
  ].join(".");
}

function sessionCookies(url: string, session: Session): Array<{ name: string; value: string }> {
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  const name = sessionCookieName(url);
  if (value.length <= 3180) return [{ name, value }];
  return Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) => ({
    name: `${name}.${index}`,
    value: value.slice(index * 3180, (index + 1) * 3180),
  }));
}

export async function authenticateAs(
  context: BrowserContext,
  fixture: keyof typeof identityFixtures,
  { expired = false }: { expired?: boolean } = {},
): Promise<Session> {
  const { url, publishableKey } = requireLocalTestEnvironment();
  const user = identityFixtures[fixture];
  const supabase = createClient(url, publishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: fixturePassword,
  });
  expect(error).toBeNull();
  expect(data.session).not.toBeNull();
  const session = {
    ...data.session!,
    access_token: expired ? expiredAccessToken(data.session!.access_token) : data.session!.access_token,
    expires_at: expired ? 1 : data.session!.expires_at,
  };

  await context.clearCookies();
  await context.addCookies(
    sessionCookies(url, session).map((cookie) => ({
      ...cookie,
      url: "http://localhost:3216",
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
  );
  return session;
}

export async function currentSession(context: BrowserContext): Promise<Session | null> {
  const { url } = requireLocalTestEnvironment();
  const name = sessionCookieName(url);
  const chunks = (await context.cookies())
    .filter((cookie) => cookie.name === name || cookie.name.startsWith(`${name}.`))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (chunks.length === 0) return null;
  const encoded = chunks.map((cookie) => cookie.value).join("");
  if (!encoded.startsWith("base64-")) return null;
  return JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString("utf8")) as Session;
}
