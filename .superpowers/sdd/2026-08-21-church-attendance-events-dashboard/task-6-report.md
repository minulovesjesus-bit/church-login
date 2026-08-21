# Task 6 report — Administrator Operations and Security Audit

## Commit

- Message: `feat: harden administrator operations`
- Base: `2d38b4924e8494bdeabd349bb205e61b166d262c`
- Final SHA: recorded in the task handoff after this report is committed; a Git commit cannot embed its own final object ID without changing that ID.
- Push/deploy: not performed

## Changed files and behavior

- `backend/admin/router.py`, `backend/admin/__init__.py`, `backend/main.py` — one consolidated `/api/admin` router owns all seven specified application, staff, and kiosk operations; every operation directly requires function-scoped `require_admin`; all administrator GET responses are `Cache-Control: no-store`.
- `backend/identity/router.py` — removed legacy administrator decorators while retaining reusable public identity routes and staff service wiring; `require_admin` now authenticates through `get_current_user`, then produces stable `FORBIDDEN` for password users and Google non-administrators.
- `backend/kiosk/router.py`, `backend/kiosk/repository.py`, `backend/kiosk/service.py` — the kiosk repository now shares the cached function-scoped database dependency with administrator authorization. The bounded administrator list includes active, expired, and revoked records and selects only the five allowlisted fields. Existing-session revoke is idempotent, locks the row, preserves timestamps on repeats, and writes exactly one metadata-only audit.
- `tests/backend/test_admin_api.py` — exact route/dependency registration, authorization matrix, same-transaction wiring, commit-before-response failure, bounded/redacted kiosk administration, immediate revoke invalidation, live application decision races, live last-admin races, audit allowlists, and attendance window reset coverage.
- `tests/backend/test_kiosk_api.py`, `tests/backend/test_kiosk_service.py` — expanded all cookie-mutation origin matrices and durable login bucket expiry/reset/password-clear coverage. Existing public kiosk contracts remain unchanged.
- `tests/backend/test_staff_workflow.py`, `tests/backend/test_student_management.py` — aligned dependency overrides with the stabilized `require_admin` boundary and removed one unused import found by Ruff; accepted locked workflows and public behavior remain intact.
- `src/app/teacher/applications/page.tsx`, `src/app/admin/staff/page.tsx`, `src/app/admin/kiosks/page.tsx` and focused tests — accessible loading/empty/error/retry/success states, terminal authorization redirects, stale/unmounted completion guards, synchronous mutation locks, target-specific confirmations, safe application 409 reconciliation, staff last-admin preservation, and Seoul-time kiosk state/revoke reconciliation. Staff/application internal UUIDs and kiosk secrets are not rendered.
- `src/app/globals.css` — semantic responsive administrator cards, state badges, and mobile layouts using the existing visual language and existing 44px action controls.

No migration was created. The installed local advisors produced no valid project findings or Supabase-managed-schema findings, and the bounded kiosk query evidence did not justify an additional index.

## Route-consolidation and transaction evidence

- Introspection tests assert each of the seven specified method/path pairs appears once in the application and once in `backend.admin.router`, and does not appear in the identity or kiosk router modules.
- Introspection also asserts each endpoint directly carries `Depends(require_admin, scope="function")`.
- Both `IdentityRepositoryDependency` and `KioskRepositoryDependency` resolve the same cached `get_database_connection` with function scope. The live mutation tests therefore exercise membership recheck, row lock, target mutation, and audit in one request transaction.
- A forced dependency commit failure yields 503 instead of a success response. Existing transaction teardown rolls back target and audit together.
- The existing locked `StaffService` remains the only application/staff mutation owner. Concurrent HTTP approval/rejection produces one 200, one `APPLICATION_ALREADY_REVIEWED` 409, one membership effect, and one application audit. Concurrent cross-demotions leave exactly one administrator; single last-admin demotion remains `LAST_ADMIN_PROTECTED` 409.
- Kiosk revoke locks the existing row. The first delete returns 204 and writes `{"reason":"administrator_revocation"}`; repeats return 204 without timestamp/audit changes; an unknown UUID returns stable `KIOSK_SESSION_NOT_FOUND` 404. Access-cookie QR issuance, refresh rotation, and a previously issued QR challenge all fail immediately after commit.
- Application audits contain only status, staff audits only role, and kiosk audits only the revocation reason. Tests explicitly exclude rejection text, names, email, phone, raw network/user-agent data, cookies, tokens, hashes, and QR material.

## Genuine RED evidence

The tests were added before their production surfaces or hardening changes.

```text
$ uv run pytest tests/backend/test_admin_api.py -v
E   ModuleNotFoundError: No module named 'backend.admin'

$ uv run pytest tests/backend/test_admin_api.py -v
FAILED test_non_google_and_non_admin_receive_stable_forbidden[password-admin]
Expected: FORBIDDEN
Received: GOOGLE_AUTH_REQUIRED

$ uv run pytest tests/backend/test_admin_api.py::test_live_kiosk_admin_list_and_idempotent_revoke_are_redacted_and_immediate -v
FAILED: administrator list returned only active sessions and omitted expired/revoked records

$ npm test -- src/app/teacher/applications/page.test.tsx src/app/admin/staff/page.test.tsx src/app/admin/kiosks/page.test.tsx
kiosk: failed to import missing page
staff: missing loading/retry and mutation-lock lifecycle
applications: missing retry/locking/reason validation/409 reconciliation/terminal-auth lifecycle
```

Those failures were resolved by the consolidated backend and lifecycle implementations. The final focused suites below are green.

## Supabase CLI discovery and database evidence

The project-local binary is Supabase CLI `2.115.0`. The commands are genuinely supported; no unavailable command is reported as passed.

```text
$ ./node_modules/.bin/supabase db lint --help
--local
--schema string
--level choice      choices: warning, error
--fail-on choice    choices: none, warning, error

$ ./node_modules/.bin/supabase db advisors --help
Checks database for security and performance issues.
--local
--type choice       choices: all, security, performance
--level choice      choices: info, warn, error
--fail-on choice    choices: none, info, warn, error
```

The strict supported commands were run without weakening their failure thresholds:

```text
$ ./node_modules/.bin/supabase db lint --local --schema app --level warning --fail-on warning
Connecting to local database...
Linting schema: app
No schema errors found
{"results":[],"message":"db lint"}

$ ./node_modules/.bin/supabase db advisors --local --type security --level warn --fail-on warn
Connecting to local database...
No issues found
{"results":[],"message":"db advisors"}

$ ./node_modules/.bin/supabase db advisors --local --type performance --level warn --fail-on warn
Connecting to local database...
No issues found
{"results":[],"message":"db advisors"}
```

No project warning and no Supabase-managed-schema warning was emitted. The exact bounded list query's local plan was:

```text
Limit  (cost=3.61..3.77 rows=65 width=48)
  ->  Sort  (cost=3.61..3.77 rows=65 width=48)
        Sort Key: last_seen_at DESC, id DESC
        ->  Seq Scan on kiosk_sessions  (cost=0.00..1.65 rows=65 width=48)
```

At this fixture size PostgreSQL estimates only 65 rows and a 1.65 sequential scan cost. With a hard result cap of 100 and a clean performance advisor, adding an index would be speculative rather than evidence-based, so no CLI migration or database reset was necessary.

## GREEN and final sequential verification

All Node commands used `v22.22.0`; both backend database variables pointed to `postgresql://postgres:postgres@127.0.0.1:54322/postgres`. Commands were run sequentially in the brief's order.

```text
$ uv run pytest tests/backend/test_admin_api.py -v
12 passed in 0.22s

$ uv run pytest tests/backend -q
411 passed, 1 warning in 17.72s

$ npm test -- src/app/teacher/applications/page.test.tsx src/app/admin/staff/page.test.tsx src/app/admin/kiosks/page.test.tsx
Test Files  3 passed (3)
Tests       15 passed (15)

$ npm test
Test Files  32 passed (32)
Tests       202 passed (202)

$ uv run ruff check backend tests/backend
All checks passed!

$ npm run typecheck
tsc --noEmit
exit 0

$ npm run lint
eslint .
exit 0

$ npm run build
Next.js 16.3.1 (Turbopack)
Compiled successfully
Generating static pages (22/22)
exit 0

$ ./node_modules/.bin/supabase db lint --local --schema app --level warning --fail-on warning
No schema errors found
exit 0

$ ./node_modules/.bin/supabase db advisors --local --type security --level warn --fail-on warn
No issues found
exit 0

$ ./node_modules/.bin/supabase db advisors --local --type performance --level warn --fail-on warn
No issues found
exit 0

$ git diff --check
exit 0
```

The sole backend warning is the pre-existing Starlette deprecation warning for importing `TestClient` through `httpx`; it recommends `httpx2`.

## Self-review

- The consolidated route boundary has no route-order ambiguity, and hidden navigation remains convenience only. Anonymous, password-provider, Google teacher, and Google administrator cases use stable backend authorization outcomes.
- Administrator lists are no-store. Kiosk SQL and DTOs contain exactly `session_id`, created/last-seen/refresh-expiry timestamps, and nullable revoke timestamp, are deterministically ordered, and clamp the limit to 100.
- Origin regression covers missing, `null`, attacker, prefix/suffix lookalikes, alternate scheme, and alternate port on login, refresh, and current-session revoke; rejection sets/clears no cookies and invokes no mutation service. Existing strict/HttpOnly/secure-environment tests remain green.
- Durable kiosk-login and attendance rate-limit tests prove expired windows resume at attempt one, the block period expires, and correct kiosk password clears the matching durable bucket. No in-memory limiter, raw identity persistence, or cleanup scheduler was added.
- Application rejection reasons are trimmed, required, capped at 500 characters, and sent only in the POST body. An already-reviewed 409 refreshes the queue and never claims duplicate success.
- All three UI mutations lock synchronously before confirmation follow-through, preserve rows/actions on failure, clear protected state on terminal auth, invalidate stale sequences, and guard unmounted writes. Kiosk state derives from absolute timestamps and refreshes its comparison clock on successful list reconciliation.
- Staff and application cards use user-facing names/emails while never showing internal user UUIDs. Kiosk session IDs are deliberately visible device identifiers; secret/hash/cookie/IP/user-agent fields and labels are absent.
- Production build, exact route tests, concurrency regressions, and strict local database tooling all passed after the final source change.

## Concerns

- No known Task 6 functional or security concern remains.
- The pre-existing Starlette/httpx deprecation warning remains outside this task.
- Task 7 still owns final authenticated real-browser flow/screenshots; Task 6 provides production-build and semantic interaction coverage but does not deploy or run that later fixture/documentation work.
