# Local development and verification

This guide reproduces the local Next.js, FastAPI, Supabase, kiosk, and Playwright environment. Run every command from the repository root. Do not use production credentials or a hosted database for the E2E fixture flow.

## Prerequisites

- Docker Desktop, running before Supabase starts
- Node.js 24.x; the repository was verified with Node 24.16.0
- Python 3.12 managed by `uv` 0.9.25 or newer (required by the pinned Vercel Python builder)
- The project-local Supabase and Vercel CLIs installed through npm
- Chromium installed by Playwright when prompted

```bash
uv python install 3.12
npm install
uv sync
npx playwright install chromium
```

Use `npx supabase ...` and `npx vercel ...` so the versions pinned in `package-lock.json` are used instead of unrelated global installations.

## Start and reset Supabase

```bash
npm run supabase:start
npx supabase status -o env
npm run supabase:reset
```

`supabase db reset` recreates the local database and applies every migration. It is destructive to local Supabase data. Do not point these commands or `DATABASE_URL` at a hosted project.

Copy `.env.example` to the ignored `.env.local`. The example contains parse-safe loopback defaults, so importing FastAPI does not fail on blank integers, booleans, lists, secrets, or timezone values. Map the three relevant outputs from `npx supabase status -o env` into these five variables:

| `.env.local` variable | `supabase status -o env` value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` |
| `SUPABASE_URL` | `API_URL` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` |
| `SUPABASE_PUBLISHABLE_KEY` | `PUBLISHABLE_KEY` |
| `DATABASE_URL` | `DB_URL` |

Keep `SUPABASE_JWT_AUDIENCE=authenticated`. Set `SUPABASE_JWKS_URL` to `${API_URL}/auth/v1/.well-known/jwks.json`, `DATABASE_CONNECT_TIMEOUT_SECONDS=2`, `DATABASE_STATEMENT_TIMEOUT_MS=5000`, `FASTAPI_ORIGIN=http://127.0.0.1:8000`, `ALLOWED_FRONTEND_ORIGINS=http://127.0.0.1:3000,http://localhost:3000`, and `APP_TIMEZONE=Asia/Seoul`. The checked-in loopback URL and database defaults match the standard local ports, but the CLI output is authoritative if they differ.

The Google, initial-admin, and kiosk variables are commented examples rather than blank typed settings. Uncomment them only after supplying real local values. FastAPI can start without the optional kiosk values, but kiosk login/QR issuance remains unavailable until `KIOSK_PASSWORD_HASH`, `KIOSK_COOKIE_SECRET`, and `QR_SIGNING_SECRET` are configured.

The Supabase publishable key is public browser configuration; it is expected in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The database URL, Supabase service-role or secret keys, kiosk password hash, QR signing secret, and kiosk cookie secret are server-only. Never name any of those secrets with `NEXT_PUBLIC_*`, commit them, print them in logs, or expose them to browser code.

## Generate local secrets

Generate the Argon2 kiosk hash without putting the shared password on the command line:

```bash
uv run python -c 'from argon2 import PasswordHasher; print(PasswordHasher().hash(input("Kiosk password: ")))'
```

Generate independent signing values. Run this command separately for `KIOSK_COOKIE_SECRET` and `QR_SIGNING_SECRET`; do not reuse one output for another variable.

```bash
openssl rand -base64 48
```

For plain-HTTP loopback development only, set `KIOSK_INSECURE_LOCAL_COOKIES=true`. The application ignores that escape hatch outside development/test loopback environments and on Vercel.

## Run the application

Run Next.js and FastAPI in separate terminals:

```bash
npm run dev
```

```bash
uv run uvicorn api.index:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:3000`. The root offers only student and teacher login. The shared kiosk is at `http://127.0.0.1:3000/qr`. FastAPI health is `http://127.0.0.1:8000/api/health`.

## Local authentication

### Student email confirmation

Email confirmation is enabled locally. Register a student, open the local mail viewer reported as `INBUCKET_URL` by `npx supabase status -o env` (current CLI versions serve Mailpit at `http://127.0.0.1:54324`), open the confirmation email, and follow the callback link. If Auth configuration changed while Supabase was running, stop and restart the local stack before retrying.

The identity Playwright spec reproduces this with the real local path: it signs up an unverified user through `/auth/signup`, proves password login is rejected, reads only that recipient's message from the loopback mail API, follows its loopback Supabase verification link, and proves password login then returns a confirmed session. A local-only fixture removes the exact owned user/application rows and exact recipient message before and after the test. It refuses non-test, Vercel, hosted Supabase/database, and hosted mail destinations.

### Google teacher login

Create OAuth credentials in Google Cloud and enable the Google provider for the local Supabase project. The Google authorized redirect URI is the Supabase callback:

```text
http://127.0.0.1:54321/auth/v1/callback
```

The application callback allowlist is separate and must include:

```text
http://127.0.0.1:3000/auth/callback
http://localhost:3000/auth/callback
```

Supply the Google client ID and secret to the local Supabase provider configuration without committing them. Actual Google OAuth verification requires valid provider credentials and an interactive provider callback; the deterministic Playwright identities do not prove that external callback.

### First administrator

Set `INITIAL_ADMIN_EMAIL` to the exact lower-case email of a verified Google user before that user signs in. The first matching `/api/me` request creates the durable bootstrap marker. Later administrators are promoted from the staff page; changing the environment value does not bootstrap a second account.

## Kiosk and camera checks

1. Open `/qr`, enter a device name and the shared kiosk password, and confirm the QR rotates every 20 seconds.
2. On a separate authenticated student browser/device, open `/student/scan` and grant camera permission.
3. Verify IN, the 10-second cooldown, then alternating OUT/IN/OUT scans.
4. Leave the kiosk open through an access-token renewal and confirm QR generation continues.
5. Permanently delete that exact session under the administrator kiosk page and confirm the kiosk returns to the locked `/qr` screen while its attendance history remains.

The automated E2E journey injects decoded QR text through a fail-closed loopback-only bridge. That verifies scanner integration, QR expiry, cooldown, attendance, and revocation, but it is not physical camera/webcam evidence. Physical camera proof requires accessible hardware and browser permission.

### Node 24 scanner deployment gate

The application targets Node 24, matching `@zxing/library@0.23.0`'s declared Node `>=24.0.0` engine. Verify a disposable clean install with strict engine checks, then run the scanner-focused tests and production build:

Before deployment, use a clean checkout in the exact deployment runtime and require all three commands to pass:

```bash
npm_config_engine_strict=true npm ci
npm test -- src/features/attendance/qr-scanner.test.tsx
npm run build
```

Run these commands under the same Node 24 major used for deployment. Vercel supports `24.x`, and the checked-in `engines.node` selects it for builds and Node Functions.

## Automated verification

Keep Docker and local Supabase running:

```bash
local_db_url=$(npx supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')
case "$local_db_url" in
  postgresql://postgres:postgres@127.0.0.1:*) ;;
  *) echo "Refusing non-loopback test database" >&2; exit 1 ;;
esac
git diff --check
npm test
TEST_DATABASE_URL="$local_db_url" DATABASE_URL="$local_db_url" uv run pytest tests/backend -v
uv run ruff check backend api tests/backend
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npm run verify:vercel-python
npx supabase db lint --local --schema app --level warning --fail-on warning
npx supabase db advisors --local --type all --level warn --fail-on warn
npm audit --omit=dev
npm audit --audit-level=critical
```

`npm audit --omit=dev` is the production dependency gate and must report zero vulnerabilities. `npm audit --audit-level=critical` is the full-tree blocking gate. A plain `npm audit` is still reviewed and recorded, but the pinned Vercel CLI currently carries dev-only upstream advisories below critical severity; do not claim that informational full audit is clean.

The E2E fixture creates fixed `identity-e2e` users only when `APP_ENV=test`, Supabase/database/backend hosts are loopback, and `VERCEL`/`VERCEL_ENV` are absent. It rejects hosted or overridden destinations before making fixture connections. The full-system identities are dedicated to that journey and are cleaned by exact identity-owned records so other specs remain order-independent.

## Vercel-shaped local runtime

`api/index.py` exports the ASGI variable `app`. The root `pyproject.toml` pins Python 3.12 and FastAPI dependencies, and `vercel.json` enables Fluid Compute while configuring exactly one Python Function entrypoint and excluding tests, docs, fixture code, and planning artifacts.

Run the production-mode Python builder directly in a disposable directory without a Vercel project, link, or deployment:

```bash
npm run verify:vercel-python
```

The command uses pinned `@vercel/python` 7.0.0 and `@vercel/build-utils` 14.3.0. It must report one `fastapi` output, the generated `vc__handler__python.vc_handler`, the catch-all route, and bundled `api/index.py` plus `backend/main.py`. `tests/backend/test_vercel_shape.py` separately imports that exact ASGI app and exercises `/api/health` plus an auth-protected database route.

The installed CLI supports an unlinked local mode:

```bash
npm run vercel:dev -- --local --listen 127.0.0.1:3000
```

Use `--local`; do not run `vercel link` merely to perform local verification. Then check `/api/health`, the root login choices, student onboarding, teacher dashboards, kiosk QR issuance, and the administrator flow. Database migrations run separately through Supabase and must never run inside a Function invocation.

With Vercel CLI 59.4.0, `vercel dev --local` starts without the earlier `deserializeBuildOutputs` crash. In this combined Next.js repository, development `/api` requests intentionally use `next.config.ts` to proxy to the separately running `FASTAPI_ORIGIN`, so this command validates the combined local routing surface but does not invoke the production Python builder. Use the deterministic builder command above for packaging evidence. Do not run `vercel build --yes` in an unlinked directory: it performs project discovery and may offer project creation.

For deployment, configure the two public Supabase values plus all server-only database/Auth/kiosk secrets in Vercel environment settings. Keep routes short-lived, store durable state only in PostgreSQL, and use a production pooler URL appropriate for serverless transactions.

Vercel runtime and plan behavior changes over time. Re-check the official documentation rather than relying on copied quotas:

- [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python)
- [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [Supported Node.js versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

No deployment, project link, or remote environment mutation is part of this local workflow.
