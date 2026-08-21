# Local development and verification

This guide reproduces the local Next.js, FastAPI, Supabase, kiosk, and Playwright environment. Run every command from the repository root. Do not use production credentials or a hosted database for the E2E fixture flow.

## Prerequisites

- Docker Desktop, running before Supabase starts
- Node.js 22.x; the repository was verified with Node 22.22.0
- Python 3.12 managed by `uv`
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

Copy `.env.example` to the ignored `.env.local`. From `supabase status -o env`, use `API_URL` for both Supabase URL variables, `PUBLISHABLE_KEY` for both publishable-key variables, and `DB_URL` for `DATABASE_URL`.

The Supabase publishable key is public browser configuration; it is expected in `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. The database URL, Supabase service-role or secret keys, kiosk password hash, QR signing secret, kiosk cookie secret, and teacher OAuth intent secret are server-only. Never name any of those secrets with `NEXT_PUBLIC_*`, commit them, print them in logs, or expose them to browser code.

## Generate local secrets

Generate the Argon2 kiosk hash without putting the shared password on the command line:

```bash
uv run python -c 'from argon2 import PasswordHasher; print(PasswordHasher().hash(input("Kiosk password: ")))'
```

Generate independent signing values. Run this command separately for `TEACHER_OAUTH_INTENT_SECRET`, `KIOSK_COOKIE_SECRET`, and `QR_SIGNING_SECRET`; do not reuse one output for another variable.

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

Open `http://127.0.0.1:3000`. The root offers only student and teacher login. The shared kiosk remains at `http://127.0.0.1:3000/login`. FastAPI health is `http://127.0.0.1:8000/api/health`.

## Local authentication

### Student email confirmation

Email confirmation is enabled locally. Register a student, open Inbucket at `http://127.0.0.1:54324`, open the confirmation email, and follow the callback link. If Auth configuration changed while Supabase was running, stop and restart the local stack before retrying.

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

1. Open `/login`, enter the shared kiosk password, and confirm the QR rotates every 20 seconds.
2. On a separate authenticated student browser/device, open `/student/scan` and grant camera permission.
3. Verify IN, the 10-second cooldown, then alternating OUT/IN/OUT scans.
4. Leave the kiosk open through an access-token renewal and confirm QR generation continues.
5. Revoke that exact session under the administrator kiosk page and confirm the kiosk returns to its password screen.

The automated E2E journey injects decoded QR text through a fail-closed loopback-only bridge. That verifies scanner integration, QR expiry, cooldown, attendance, and revocation, but it is not physical camera/webcam evidence. Physical camera proof requires accessible hardware and browser permission.

## Automated verification

Keep Docker and local Supabase running:

```bash
git diff --check
npm test
uv run pytest tests/backend -v
uv run ruff check backend api tests/backend
npm run typecheck
npm run lint
npm run build
npm run test:e2e
npx supabase db lint --local --schema app --level warning --fail-on warning
npx supabase db advisors --local --type all --level warn --fail-on warn
npm audit --omit=dev
npm audit
```

The E2E fixture creates fixed `identity-e2e` users only when `APP_ENV=test`, Supabase/database/backend hosts are loopback, and `VERCEL`/`VERCEL_ENV` are absent. It rejects hosted or overridden destinations before making fixture connections. The full-system identities are dedicated to that journey and are cleaned by exact identity-owned records so other specs remain order-independent.

## Vercel-shaped local runtime

`api/index.py` exports the ASGI variable `app`. The root `pyproject.toml` pins Python 3.12 and FastAPI dependencies, and `vercel.json` enables Fluid Compute while excluding tests, docs, fixture code, and planning artifacts from the Python Function bundle.

The installed CLI supports an unlinked local mode:

```bash
npm run vercel:dev -- --local --listen 127.0.0.1:3000
```

Use `--local`; do not run `vercel link` merely to perform local verification. Then check `/api/health`, the root login choices, student onboarding, teacher dashboards, kiosk QR issuance, and the administrator flow. Database migrations run separately through Supabase and must never run inside a Function invocation.

With the repository's pinned Vercel CLI 59.3.0, the 2026-08-22 local verification attempt detected `@vercel/python` 6.58.0, completed the Next.js production build, and then stopped inside the CLI's `deserializeOutput`/`deserializeBuildOutputs` code with `ERR_INVALID_ARG_TYPE` (`Buffer.from` received `undefined`) before the Python builder ran or a server listened. `.vercel/project.json` remained absent. Until that external local-mode CLI failure is resolved, use the separate Next/FastAPI servers above for local flows and keep `vercel dev --local` as an explicit blocked check; do not link or deploy merely to bypass it.

For deployment, configure the two public Supabase values plus all server-only database/Auth/kiosk secrets in Vercel environment settings. Keep routes short-lived, store durable state only in PostgreSQL, and use a production pooler URL appropriate for serverless transactions.

Vercel runtime and plan behavior changes over time. Re-check the official documentation rather than relying on copied quotas:

- [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python)
- [FastAPI on Vercel](https://vercel.com/docs/frameworks/backend/fastapi)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)

No deployment, project link, or remote environment mutation is part of this local workflow.
