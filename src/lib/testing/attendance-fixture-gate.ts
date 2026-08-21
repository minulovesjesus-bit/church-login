type Environment = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const LIBPQ_DESTINATION_PARAMETERS = new Set(["host", "hostaddr", "service", "servicefile"]);
const LIBPQ_DESTINATION_ENVIRONMENT = ["PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE"];

function loopbackUrl(value: string | undefined, schemes: Set<string>): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return schemes.has(parsed.protocol) && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function loopbackDatabaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    if (!["postgres:", "postgresql:"].includes(parsed.protocol)) return false;
    if (!LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    return Array.from(parsed.searchParams.keys()).every(
      (key) => !LIBPQ_DESTINATION_PARAMETERS.has(key.toLowerCase()),
    );
  } catch {
    return false;
  }
}

export function attendanceFixtureEnabled(environment: Environment): boolean {
  if (environment.APP_ENV !== "test") return false;
  if (environment.VERCEL !== undefined || environment.VERCEL_ENV !== undefined) return false;
  if (LIBPQ_DESTINATION_ENVIRONMENT.some((name) => environment[name] !== undefined)) return false;
  return loopbackUrl(environment.SUPABASE_URL, new Set(["http:", "https:"]))
    && loopbackDatabaseUrl(environment.DATABASE_URL)
    && loopbackUrl(environment.FASTAPI_ORIGIN, new Set(["http:", "https:"]));
}
