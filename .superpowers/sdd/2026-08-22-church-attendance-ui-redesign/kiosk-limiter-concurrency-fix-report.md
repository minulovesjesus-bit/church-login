# Kiosk limiter concurrency fix report

Date: 2026-08-23 (Asia/Seoul)

Base: `dbbd6f3026d27dc3e0e3e476f4b79a29cec3ce82`

Scope: reopened kiosk-login limiter race only; local database and local commit,
with no push, deployment, hosted Supabase access, or Vercel project mutation.

## Finding and root cause

The previous service checked `blocked_until` before Argon2 and recorded a
failure only after Argon2 returned. The lookup was an unlocked `SELECT`, so
eight simultaneous requests for one bucket all observed an unblocked row and
all eight entered the expensive verifier before any failure became visible.
The sequential five-attempt behavior was correct, but it did not compose across
concurrent FastAPI/Vercel invocations.

An in-process lock was rejected because it cannot coordinate separate Vercel
instances.

## RED

The production mutation caught by the new regression is moving/counting the
attempt after verification, or replacing the database reservation with an
instance-local/global lock.

The RED command used a real loopback PostgreSQL database, eight independent
connections, an async start barrier, and a thread-safe gated verifier:

```sh
local_db_url=$(npx supabase status -o env | sed -n 's/^DB_URL="\(.*\)"$/\1/p')
TEST_DATABASE_URL="$local_db_url" DATABASE_URL="$local_db_url" uv run pytest \
  tests/backend/test_kiosk_service.py::test_password_verifier_exception_keeps_the_reserved_attempt \
  tests/backend/test_kiosk_service.py::test_password_verifier_cancellation_keeps_the_reserved_attempt \
  tests/backend/test_kiosk_service.py::test_postgres_concurrent_logins_bound_password_verification_per_bucket -q
```

Result: **3 failed, 1 passed** in 0.13 seconds.

- Same bucket: expected at most 5 verifier calls, observed **8**.
- Verifier exception: expected one retained reservation, observed 0.
- Coroutine cancellation while the Argon2 thread was running: expected one
  retained reservation, observed 0.
- Eight distinct buckets already behaved independently and passed.

The first focused post-fix regression run exposed a second real concurrency
edge: bounded cleanup waited on an expired row being deleted by another
transaction and reached the five-second statement timeout. That row-selection
path was changed to exclude the current reservation key and use
`FOR UPDATE SKIP LOCKED`; the complete focused rerun then passed.

## Fix

`KioskRepository.reserve_rate_limit_attempt` now performs bounded cleanup and
the reservation in one short, independently committed application transaction.
Its single PostgreSQL statement:

- selects no more than 100 expired rows through the existing
  `(action, expires_at, bucket_key_hash)` index;
- skips locked cleanup rows and never selects the key being reserved;
- atomically `INSERT ... ON CONFLICT DO UPDATE`s the bucket;
- resets an expired five-minute window to attempt 1;
- increments an active window exactly once per submitted attempt;
- sets the 15-minute `blocked_until` when attempt 5 is reserved;
- returns a row for attempts allowed to enter Argon2 and no row while an
  existing block is active.

The reservation transaction commits before `asyncio.to_thread` starts Argon2.
This releases the row lock quickly for concurrent serverless invocations and
makes the attempt durable even if the verifier raises or the request coroutine
is cancelled. There is no post-verification failure write, so wrong passwords
are not double-counted.

The fifth reservation is allowed to perform verification while simultaneously
establishing the block. The sixth and later reservations receive no row and are
rejected before Argon2. This preserves the configured five-verification window
and existing `blocked_until` semantics.

On a correct password, the existing `clear_rate_limit` runs before the kiosk
session insert in the request transaction. A successful login therefore clears
the reservation and prior failures; if later session work fails, that request
transaction rolls back and the already durable reservation remains fail-safe.
Password/session/token/cookie contracts, the IP-only HMAC, User-Agent
independence, and trusted Vercel IP boundary were not changed.

No schema change or migration was required. The existing `expires_at` column
and index from migration `20260822143631_rate_limit_bucket_expiry.sql` are used.

## GREEN concurrency evidence

The same RED group passed **4/4** in 0.28 seconds after the atomic reservation.
The complete kiosk security/service/API group then passed **59/59** in 1.46
seconds.

The behavioral assertions recorded these exact bounds:

- eight simultaneous requests, one shared bucket: **5 total verifier calls**
  (maximum allowed and observed), durable `attempt_count = 5`, active block;
- eight simultaneous requests, eight different buckets: **8 total verifier
  calls and max_active = 8**, proving no global or process-wide serialization;
- verifier exception: reservation remains at 1 and the original exception is
  propagated;
- request cancellation during verifier execution: cancellation propagates and
  reservation remains at 1;
- wrong password: one reservation only, with no second increment;
- correct password: the reserved bucket is cleared and normal session/token
  behavior remains unchanged.

## Final verification

All database commands used a DSN derived from `supabase status` and rejected
anything other than `postgresql://postgres:postgres@127.0.0.1:*`.

| Gate | Result |
| --- | --- |
| local `npm run supabase:reset` | pass; all 8 existing migrations reapplied |
| focused kiosk security/service/API | **59 passed**, 1.46s |
| full `uv run pytest tests/backend -q` | **449 passed**, 1 upstream Starlette warning, 20.56s |
| `uv run ruff check backend tests/backend` | pass |
| `npx supabase db lint --local --level warning` | no schema errors |
| `npx supabase db advisors --local --type all --level warn --fail-on warn` | no issues |
| `git diff --check` | pass |

Frontend, Node dependencies, UI, Vercel configuration, migrations, cookies,
sessions, and password hashing parameters were not changed, so frontend/build
gates were not rerun for this backend-only fix.

## Residual limitations

No hosted multi-instance deployment was performed because deployment and
external state changes were prohibited. The eight-connection PostgreSQL test
exercises the cross-connection behavior that an in-process lock cannot satisfy,
and the atomic uniqueness conflict is enforced by PostgreSQL itself.
