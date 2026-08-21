# Church Attendance System

Next.js 16 renders the browser application and keeps the Supabase Auth session. FastAPI is the only application-data API and is the authorization authority: it verifies the bearer identity, loads the current staff membership from PostgreSQL, and decides every student, teacher, and administrator capability.

## Local prerequisites

- Node.js 22
- Python 3.12 managed by `uv`
- Docker Desktop
- Supabase CLI (the pinned npm development dependency is used by `npx`)

Install dependencies and start the local services from the repository root:

```bash
npm install
uv sync
npx supabase start
npx supabase db reset
```

Read the local, non-production values with `npx supabase status -o env`, then create an ignored `.env.local` from `.env.example`. Use `API_URL` for both Supabase URL variables, `PUBLISHABLE_KEY` for both publishable-key variables, and `DB_URL` for `DATABASE_URL`:

```dotenv
APP_ENV=development
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<local PUBLISHABLE_KEY>
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_PUBLISHABLE_KEY=<local PUBLISHABLE_KEY>
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_JWKS_URL=http://127.0.0.1:54321/auth/v1/.well-known/jwks.json
DATABASE_URL=<local DB_URL>
DATABASE_CONNECT_TIMEOUT_SECONDS=2
DATABASE_STATEMENT_TIMEOUT_MS=5000
FASTAPI_ORIGIN=http://127.0.0.1:8000
INITIAL_ADMIN_EMAIL=<exact lower-case Google email>
TEACHER_OAUTH_INTENT_SECRET=<at least 32 random bytes, server-only>
KIOSK_PASSWORD_HASH=<Argon2 hash of the shared kiosk password>
KIOSK_COOKIE_SECRET=<at least 32 random bytes, server-only>
ALLOWED_FRONTEND_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
APP_TIMEZONE=Asia/Seoul
```

FastAPI loads `.env` first and `.env.local` second; explicitly supplied process environment variables take final precedence. The database connection and statement timeout budget is validated at no more than eight seconds so ordinary Function requests retain time for authentication and response handling.

Generate `TEACHER_OAUTH_INTENT_SECRET` and `KIOSK_COOKIE_SECRET` locally with a cryptographically secure generator such as `openssl rand -base64 32`; never prefix either with `NEXT_PUBLIC_`. Generate `KIOSK_PASSWORD_HASH` with Argon2 and keep the shared password itself out of environment files. Do not copy `SECRET_KEY`, `SERVICE_ROLE_KEY`, or `JWT_SECRET` into browser variables or application runtime configuration. `.env.local` is ignored by Git. The Playwright harness reads ephemeral local Admin credentials directly from `supabase status` only after enforcing `APP_ENV=test` and a loopback Supabase URL.

Run Next.js and FastAPI in separate terminals:

```bash
npm run dev
```

```bash
uv run uvicorn api.index:app --reload --port 8000
```

Open `http://127.0.0.1:3000`. `GET http://127.0.0.1:8000/api/health` should return `{"status":"ok"}`.

## Supabase Auth setup

Email confirmation is enabled in `supabase/config.toml`. After student email/password registration, open local Inbucket at `http://127.0.0.1:54324`, open the confirmation email, and follow its link back to `/auth/callback`. If the Supabase stack was already running before an Auth config change, restart it before testing the new setting.

For Google OAuth, configure the Google provider in Supabase Auth with the client ID and secret from Google Cloud. The Google OAuth authorized redirect URI points to Supabase Auth, not directly to Next.js:

- Local: `http://127.0.0.1:54321/auth/v1/callback`
- Hosted: `https://<project-ref>.supabase.co/auth/v1/callback`

The application redirect allowlist must separately include `http://127.0.0.1:3000/auth/callback`, `http://localhost:3000/auth/callback`, and the production `https://<domain>/auth/callback`. Keep the Google client secret server-side.

The first administrator is bootstrapped during the normal `/api/me` request only when a verified Google user signs in with the exact lower-case `INITIAL_ADMIN_EMAIL`. The bootstrap marker is global and durable: changing the configured email later cannot promote another identity, and demoting the original administrator does not promote them again. Later role changes come from the administrator UI; staff roles are stored in PostgreSQL, never user-editable Supabase metadata.

Teacher OAuth starts at the server route `/auth/teacher/start`. It creates a five-minute signed, browser-bound intent for `/teacher`, keeps the signing secret server-only, and preserves Supabase PKCE. The callback consumes the intent cookie and safely falls back to student onboarding when the intent is absent, invalid, expired, or replayed.

## Tests

Keep the local Supabase stack running, then run:

```bash
npm test
uv run pytest tests/backend -v
npm run typecheck
npm run lint
npm run build
npm run test:e2e -- tests/e2e/identity.spec.ts
```

The Playwright command uses bounded Next.js/FastAPI `webServer` processes, creates deterministic users only in the local Supabase project, and removes them afterward. Fixture imports fail unless `APP_ENV=test`; a hosted Supabase URL is also rejected. There is no production authentication bypass.

## Vercel-shaped local smoke

After authenticating the Vercel CLI and linking the intended project, provide the same non-secret public Auth values plus the server-only production `DATABASE_URL`, bounded database timeouts, `INITIAL_ADMIN_EMAIL`, `TEACHER_OAUTH_INTENT_SECRET`, explicit `ALLOWED_FRONTEND_ORIGINS`, and `APP_TIMEZONE=Asia/Seoul` through Vercel environment settings. Production must not set `APP_ENV=test`, and must not expose the teacher-intent secret or a Supabase secret/service-role key to `NEXT_PUBLIC_*` variables.

Run the combined routing shape:

```bash
npm run vercel:dev
```

Then verify `GET http://127.0.0.1:3000/api/health` and the two root links, `학생으로 로그인` and `교사로 로그인`. `vercel.json` keeps one Python entrypoint at `api/index.py`, enables Fluid Compute, and excludes tests, local fixtures, and planning artifacts from the Python Function bundle. Database migrations must run separately; a Function invocation never runs migrations.

## Vercel Hobby operating constraints

Checked against Vercel documentation on 2026-08-21. Hobby is for personal, non-commercial use. A church-wide production deployment needs an explicit eligibility and plan review. Current included monthly usage is 1,000,000 Function invocations, 4 active CPU-hours, and 360 GB-hours of provisioned memory; exceeding a Hobby quota can pause that feature until its usage window resets. Hobby Functions currently have a 300-second maximum duration, but normal API requests in this application must remain short and must not rely on background work, sticky sessions, writable local files, or in-memory durability. Hobby runtime logs are retained for one hour.

All durable application state belongs in Supabase/PostgreSQL. Use a Supavisor transaction-pooler URL for production `DATABASE_URL`, keep transactions short, and re-check the current Hobby limits and fair-use terms before deployment.
