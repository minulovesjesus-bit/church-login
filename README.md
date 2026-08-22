# Church Attendance System

Responsive student, teacher, administrator, and shared-kiosk attendance application. Next.js 16 owns the browser experience and Supabase Auth session. FastAPI is the application-data and authorization authority, with durable state in Supabase PostgreSQL.

## Local start

Requirements: Docker Desktop, Node.js 24, Python 3.12 through `uv` 0.9.25 or newer, and the npm-pinned Supabase CLI.

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

## Vercel shape

`api/index.py` exports the FastAPI ASGI `app`; the root `pyproject.toml` supplies Python 3.12 requirements and dependencies. `vercel.json` enables Fluid Compute and configures one `api/index.py` Python Function bundle. The deterministic builder smoke invokes the pinned `@vercel/python` builder in a disposable directory, proves one `fastapi` output, verifies the generated handler and bundled app imports, and exercises `/api` routing with ASGI tests:

```bash
npm run verify:vercel-python
```

`vercel dev --local` remains useful for the combined browser surface, but development `/api` requests intentionally proxy to the separately running loopback FastAPI server. It is not Python builder evidence and does not link or create a Vercel project.

Do not expose database, service-role, teacher-intent, kiosk, QR, or cookie secrets through `NEXT_PUBLIC_*`. The Supabase publishable key is public configuration; privileged credentials remain server-only.

Vercel limits and plan terms are time-sensitive. Check the current official [Python runtime](https://vercel.com/docs/functions/runtimes/python), [FastAPI](https://vercel.com/docs/frameworks/backend/fastapi), [Function limits](https://vercel.com/docs/functions/limitations), and [Hobby plan](https://vercel.com/docs/plans/hobby) documentation before deployment.

The repository and Vercel runtime target Node 24, matching the scanner's transitive `@zxing/library@0.23.0` requirement. Follow the strict clean-install, scanner-test, and production-build gate in [docs/local-development.md](docs/local-development.md).
