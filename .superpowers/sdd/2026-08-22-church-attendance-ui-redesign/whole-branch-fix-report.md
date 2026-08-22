# Whole-branch final fix wave report

Date: 2026-08-22–23 (Asia/Seoul)

Base: `eda113756edbb78d214fccd21c52fc75cfdfec6d`

Scope: one local-only fix wave; no push, deployment, Vercel project/link creation, or hosted Supabase mutation

## Outcome

All eight requested findings were fixed. The final local gates pass with Node
24.16.0, npm 11.13.0, Python 3.12, a reset loopback Supabase fixture, and the
pinned Vercel Python builder. The production dependency audit is clean and the
full audit has no critical findings. A plain full audit still reports 27
development-only transitive findings in the Vercel CLI graph; this residual is
documented below instead of being hidden with `--force`.

No UI implementation or snapshot baseline was changed.

## TDD baseline (RED)

The focused Python RED run added the security, boundary, concurrency, rotation,
and packaging expectations before implementation. Result: **14 failed, 77
passed**. The failures demonstrated:

- different User-Agent strings produced different kiosk buckets;
- an already-blocked login still called the Argon2 verifier;
- synchronous verification stalled the event loop (`0.085s > 0.05s`);
- no bounded expiry cleanup API or invocation existed;
- a Seoul-valid birth date was rejected between 00:00 and 08:59 KST;
- profile upsert ran with a UTC database transaction;
- an unseen JWKS `kid` was rejected while the cache TTL was active, concurrent
  misses were not refreshable, and unknown-key negative caching was absent;
- the Vercel entrypoint/routing smoke initially used the wrong protected path,
  which was corrected to the real `/api/teacher/students` contract before GREEN.

The focused frontend/config RED run was:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm test -- \
  src/app/auth/callback/teacher-intent.test.ts \
  src/app/auth/callback/legacy-next.test.ts vercel.test.ts
```

Result: **3 failed, 5 passed**. Both teacher callback error paths incorrectly
returned to `/auth/login`, and `vercel.json` still selected a Python glob rather
than one explicit function entrypoint.

After implementation, the same focused groups passed: **91 Python tests** and
**8 Vitest tests**.

## Finding 1 — kiosk limiter

### Fix

- The bucket HMAC now contains only the canonical client IP; User-Agent remains
  in the compatibility function signature but is intentionally ignored.
- Outside Vercel, only the ASGI peer address is accepted. When the trusted Vercel
  system environment marker is present, the code consumes
  `x-vercel-forwarded-for`, validates it as one IP address, and canonicalizes it
  with `ipaddress`; arbitrary `x-forwarded-for` is never trusted.
- A blocked bucket is rejected before password verification.
- Argon2 verification runs through `asyncio.to_thread`, so it does not block the
  FastAPI event loop.
- `expires_at` was added through migration
  `20260822143631_rate_limit_bucket_expiry.sql`, indexed by
  `(action, expires_at, bucket_key_hash)`. Kiosk login deletes at most 100
  ordered expired rows per request. The existing attendance limiter was updated
  for the new non-null column and performs the same bounded cleanup inside its
  statement.

### GREEN

Behavioral/API/service/database tests prove User-Agent rotation stability,
untrusted forwarded-header rejection, Vercel-boundary IP separation, verifier
skipping while blocked, event-loop progress during a slow verifier, and cleanup
of 125 expired rows in bounded 100 + 25 batches.

Official basis: Vercel documents that its request IP headers are produced at the
Vercel proxy boundary and describes `X-Vercel-Forwarded-For` alongside the
overwritten `X-Forwarded-For` behavior:
<https://vercel.com/docs/headers/request-headers>.

## Finding 2 — Seoul date boundary

### Fix

- `StudentProfileInput.birth_date` compares against
  `datetime.now(ZoneInfo("Asia/Seoul")).date()`.
- Every application transaction sets PostgreSQL `TimeZone` from the validated
  `Asia/Seoul` setting immediately after assuming `app_backend`.
- The student profile upsert also sets the transaction timezone before its first
  data-writing statement, keeping the database `current_date` constraint aligned
  with API validation even when the repository is instantiated directly.

### GREEN

The deterministic validator test freezes times immediately before and after the
UTC/KST date rollover. The live loopback database test verifies that the profile
upsert changes the transaction timezone before the insert and accepts the Seoul
boundary date. The complete schema suite passes after a fresh local reset.

## Finding 3 — JWKS rotation

### Fix

An unknown `kid` now enters the existing async cache lock and performs one
bounded refresh even when the ordinary TTL is still active. Concurrent misses
therefore share one fetch. A successful fetch that still lacks the requested
key starts a bounded 5-second global unknown-key backoff; repeated or random
`kid` values cannot cause a refresh storm. Fetch failures retain their existing
bounded failure backoff. Known keys inside the normal TTL remain cache hits.

Issuer, audience, allowed algorithms, signature, expiry, and required-claim
verification were not weakened.

### GREEN

New async tests prove immediate rotation success, one fetch for concurrent
unknown-key requests, no extra fetch for repeated or different random keys in
the negative window, and unchanged normal TTL behavior.

Official basis: Supabase documents the project JWKS endpoint, asymmetric signing
keys, edge caching, and rotation overlap:
<https://supabase.com/docs/guides/auth/signing-keys>. The official changelog was
also rechecked on 2026-08-22: <https://supabase.com/changelog.md>.

## Finding 4 — Node runtime and scanner

### Fix

- `engines.node` is `24.x` and `@types/node` is 24.13.3.
- The lockfile was regenerated with Node 24/npm 11.
- Documentation and reproducible gates consistently use Node 24.

The installed scanner graph is `@zxing/browser@0.2.1` ->
`@zxing/library@0.23.0`, whose engine requires Node 24.

### GREEN

A disposable copy of the current source passed:

```sh
PATH=/opt/homebrew/opt/node@24/bin:$PATH \
  npm_config_engine_strict=true npm ci
PATH=/opt/homebrew/opt/node@24/bin:$PATH \
  npm test -- src/features/attendance/qr-scanner.test.tsx
PATH=/opt/homebrew/opt/node@24/bin:$PATH npm run build
```

Results: clean install added 1,103 packages, **17 scanner tests passed**, and
Next.js generated all 22 routes. The ordinary workspace build passed as well.

Official basis: Vercel lists Node 24.x as supported/default and states that
`engines.node` selects the runtime:
<https://vercel.com/docs/functions/runtimes/node-js/node-js-versions>.

## Finding 5 — Vercel-compatible FastAPI shape

### Fix

- Vercel CLI is pinned to 59.4.0; `@vercel/python@7.0.0` and compatible
  `@vercel/build-utils@14.3.0` are explicit development dependencies.
- `vercel.json` names only `api/index.py` as the Python function.
- `npm run verify:vercel-python` invokes the production Python builder directly
  in a disposable unlinked directory and asserts result version 2, a single
  `fastapi` output, generated Python handler, catch-all route, and inclusion of
  both `api/index.py` and `backend/main.py`.
- A deterministic ASGI smoke imports that exact entrypoint and exercises
  `/api/health` (200) plus `/api/teacher/students` without auth (401).

### GREEN

The builder ran with Python 3.12 and disposable `uv 0.9.25`:

```json
{"resultVersion":2,"outputKeys":["fastapi"],"handler":"vc__handler__python.vc_handler","routeCount":2,"bundledApiEntrypoint":true,"bundledBackendApp":true}
```

`vercel dev --local` under CLI 59.4.0 started without the earlier
`deserializeBuildOutputs` failure. In this combined repository, Next development
rewrites `/api` to a separately started loopback Uvicorn process; `vercel dev`
alone therefore returned 500 for `/api` and is not claimed as Python production
builder evidence. No `.vercel/project.json` exists. An attempted standalone
unlinked `vercel build --yes` stopped during project discovery because the
disposable directory name was not a valid project name; it did not create/link
a project and is not counted as evidence.

Official basis: Vercel documents `api/index.py` exporting `app` for FastAPI and
the Python Function runtime here:
<https://vercel.com/docs/frameworks/backend/fastapi> and
<https://vercel.com/docs/functions/runtimes/python>.

Residual limitation: no linked Vercel production build or real deployment was
performed, as explicitly prohibited. The direct current builder output plus ASGI
import/routing smoke is the strongest local, non-mutating evidence available.

## Finding 6 — dependency audits

### Fix

- `shadcn@4.19.0` moved from production dependencies to development
  dependencies.
- The Vercel packages received targeted compatible updates.
- `tar` is overridden to 7.5.22, eliminating the previous full-tree critical
  advisory without `--force` or a major downgrade.
- Audit documentation distinguishes the clean production gate, critical
  full-tree gate, and informational plain full audit.

### GREEN and risk decision

- `npm audit --omit=dev --audit-level=high`: **0 vulnerabilities**, exit 0.
- `npm audit --audit-level=critical`: **0 critical**, exit 0.
- Plain `npm audit`: exit 1, **27 findings** (1 low, 12 moderate, 14 high), all
  reachable only through development tooling and omitted from the production
  graph. Most are in Vercel CLI/builder packages; `npm explain` also shows the
  flagged root `js-yaml` through dev-only Vercel, shadcn, and lint tooling.
- `npm audit fix --dry-run` changed nothing. npm offers a forced Vercel downgrade
  to 54.17.3 for the remaining graph, which would be a breaking and unreviewed
  regression. It was correctly not applied.

This is an explicit dev-tool risk acceptance, not a claim that the full
informational audit is clean.

## Finding 7 — README backend test command

The README and local-development guide now derive the DSN from
`supabase status`, reject anything other than loopback, and pass the same value
as both `TEST_DATABASE_URL` and `DATABASE_URL`. The advertised command therefore
does not raise `KeyError` and cannot silently point fixture-writing tests at a
hosted database.

## Finding 8 — teacher OAuth callback

The callback validates the signed teacher intent separately from an arbitrary
`next` parameter. Missing-code and code-exchange failures with valid teacher
intent return to `/teacher/login?error=oauth_callback` without consuming the
intent cookie, allowing a safe retry. Student failures remain `/auth/login`.
Success still consumes the teacher intent and preserves the existing destination
allowlist. New route tests cover both failures, student behavior, success, and
malformed/open-redirect input.

## Final verification ledger

All Node commands below used
`PATH=/opt/homebrew/opt/node@24/bin:$PATH` unless noted.

| Gate | Result |
| --- | --- |
| `uv run ruff check backend tests/backend` | pass |
| fresh loopback DB reset and all migrations | pass; migration `20260822143631` applied |
| `TEST_DATABASE_URL=<loopback> DATABASE_URL=<loopback> uv run pytest tests/backend -q` | **445 passed**, 1 upstream Starlette deprecation warning, 20.33s |
| `npx supabase db lint --local --level warning` | no schema errors |
| `npx supabase db advisors --local --type all --level warn --fail-on warn` | no issues |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm test -- --reporter=dot` | **39 files, 296 tests passed** |
| scanner-focused Vitest | **1 file, 17 tests passed** |
| `npm run build` | pass; 22 routes generated |
| disposable engine-strict `npm ci` + scanner + build | pass |
| `npm run verify:vercel-python` with disposable uv 0.9.25 | pass; one FastAPI output/bundle verified |
| Vercel ASGI health + protected route smoke | included in the **445** Python tests |
| identity + attendance + full-system E2E | **8 passed**, 1.8m |
| UI visual/accessibility E2E | **5 passed**, 27.2s; no snapshot updates |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities |
| `npm audit --audit-level=critical` | exit 0; no critical |
| `git diff --check` | pass |
| changed-diff secret pattern scan | pass |
| `.vercel/project.json` | absent |
| `next-env.d.ts` | restored; no diff |

The initial single-process run of all 13 Playwright tests produced 11 passes and
two visual failures because preceding attendance/full-system specs left one and
two scans on identities visible to the visual teacher dashboard. The diff images
showed only those counts/rows. The visual spec now reapplies the existing
fail-closed loopback identity seed in `beforeAll`, so it owns a deterministic
baseline even after mutating flows. A second combined run crossed midnight in
Asia/Seoul: the fourth full-system scan correctly became the new day's first
`IN`, and the teacher query showed 2026-08-23 rather than the 2026-08-22
snapshot. A post-midnight combined run passed all functional flows and 4/5
visual tests (12/13 overall); its only diff was the one date digit. The visual
test now fixes both its browser clock and the dashboard response display date
before its first teacher page request. The final visual rerun and the earlier
independent functional run produced the clean 5/5 and 8/8 results above.

The first post-fix full Python run also exposed residue from an earlier
interrupted fixture run and an overly broad schema-test query (443 passed, 2
failed). The schema assertion was narrowed to its owned opaque bucket, the local
database was reset, and the clean full rerun produced 445/445. No hosted database
was contacted.

## Residual limitations

1. Real Vercel project build/deploy evidence remains unavailable without the
   prohibited external link/project/deployment state.
2. Plain full npm audit remains non-zero for 27 development-only advisories in
   upstream tool graphs (primarily Vercel); production is clean and no critical
   remains.
3. Playwright screenshot baselines remain intentionally Darwin Chromium
   specific, matching the existing project ruling.
