# Church Attendance System

Responsive student, teacher, administrator, and shared-kiosk attendance application. Next.js 16 owns the browser experience and Supabase Auth session. FastAPI is the application-data and authorization authority, with durable state in Supabase PostgreSQL.

## Local start

Requirements: Docker Desktop, Node.js 22, Python 3.12 through `uv`, and the npm-pinned Supabase CLI.

```bash
npm install
uv sync
npm run supabase:start
npm run supabase:reset
```

Create an ignored `.env.local` from `.env.example`, using the loopback values printed by `npx supabase status -o env`. Then run the two development servers in separate terminals:

```bash
npm run dev
```

```bash
uv run uvicorn api.index:app --reload --host 127.0.0.1 --port 8000
```

Open `http://127.0.0.1:3000`; the shared kiosk is at `/login`.

The complete guide covers local Google OAuth, Inbucket confirmation, initial-admin bootstrap, secret generation, kiosk/camera checks, E2E fixture safety, database tooling, and unlinked `vercel dev`: [docs/local-development.md](docs/local-development.md).

## Verification

Keep Docker and local Supabase running, then run:

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

## Vercel shape

`api/index.py` exports the FastAPI ASGI `app`; the root `pyproject.toml` supplies Python 3.12 requirements and dependencies. `vercel.json` enables Fluid Compute and excludes development-only files from the Python Function bundle. Use local mode without linking a project:

```bash
npm run vercel:dev -- --local
```

Do not expose database, service-role, teacher-intent, kiosk, QR, or cookie secrets through `NEXT_PUBLIC_*`. The Supabase publishable key is public configuration; privileged credentials remain server-only.

Vercel limits and plan terms are time-sensitive. Check the current official [Python runtime](https://vercel.com/docs/functions/runtimes/python), [FastAPI](https://vercel.com/docs/frameworks/backend/fastapi), [Function limits](https://vercel.com/docs/functions/limitations), and [Hobby plan](https://vercel.com/docs/plans/hobby) documentation before deployment.

Node 22 scanner deployment remains gated: the lockfile's transitive `@zxing/library@0.23.0` declares Node 24 or newer. Follow the strict clean-install, scanner-test, and production-build gate in [docs/local-development.md](docs/local-development.md); passing the current build alone is not a compatibility claim.
