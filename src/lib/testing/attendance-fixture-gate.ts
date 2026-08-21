type Environment = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function loopbackUrl(value: string | undefined, schemes: Set<string>): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return schemes.has(parsed.protocol) && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export function attendanceFixtureEnabled(environment: Environment): boolean {
  if (environment.APP_ENV !== "test") return false;
  if (environment.VERCEL !== undefined || environment.VERCEL_ENV !== undefined) return false;
  return loopbackUrl(environment.SUPABASE_URL, new Set(["http:", "https:"]))
    && loopbackUrl(environment.DATABASE_URL, new Set(["postgres:", "postgresql:"]))
    && loopbackUrl(environment.FASTAPI_ORIGIN, new Set(["http:", "https:"]));
}
