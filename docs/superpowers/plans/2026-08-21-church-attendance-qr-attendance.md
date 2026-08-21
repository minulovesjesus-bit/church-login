# Church Attendance QR and Attendance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver renewable shared-device sessions, 20-second QR attendance, alternating entry/exit records, and student/teacher attendance statistics.

**Architecture:** FastAPI issues signed QR challenges only to durable kiosk sessions and validates student JWTs before recording a scan. PostgreSQL performs each transition under a student-and-date transaction lock; Next.js provides the kiosk display, camera scanner, attendance history, and teacher attendance views.

**Tech Stack:** Foundation plan stack plus Argon2-cffi 25.1.0, PyJWT 2.13.0, QRCode 1.5.4, ZXing Browser 0.2.1, Recharts 3.10.1, PostgreSQL advisory transaction locks

**Spec:** `docs/superpowers/specs/2026-08-21-church-attendance-system-design.md`

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-21-church-attendance-foundation-identity.md` first.
- QR challenges are valid for exactly 20 seconds and contain no student or personal data.
- Accepted scans alternate `IN -> OUT -> IN -> OUT` per student and `Asia/Seoul` date.
- Reject new accepted scans within 10 seconds of the student's previous accepted, non-voided scan.
- Make retries idempotent through unique `(student_id, request_id)` values.
- Keep FastAPI stateless; persist kiosk sessions, refresh-token hashes, scan rows, and rate-limit buckets in PostgreSQL.
- Hash the shared kiosk password with Argon2 and keep it separate from QR and cookie signing secrets.
- Never trust a direction, student ID, timestamp, or kiosk ID supplied by the student browser.
- Preserve scan history; teacher corrections void rows or append audited manual rows.
- Test every security boundary, time boundary, and transaction boundary before UI polish.

## File Structure

### Database and backend

- Generated `supabase/migrations/*_attendance_core.sql`: kiosk, attendance, and rate-limit tables and indexes.
- `backend/core/clock.py`: injectable UTC clock for exact time tests.
- `backend/core/rate_limit.py`: durable fixed-window limiter.
- `backend/kiosk/schemas.py`: kiosk API DTOs.
- `backend/kiosk/repository.py`: kiosk session and token-rotation SQL.
- `backend/kiosk/security.py`: Argon2 password and opaque-token hashing.
- `backend/kiosk/service.py`: login, refresh, revoke, and QR issuance.
- `backend/kiosk/router.py`: `/api/kiosk/*` cookie endpoints.
- `backend/attendance/models.py`: directions and attendance value objects.
- `backend/attendance/schemas.py`: scan, history, correction, and statistic DTOs.
- `backend/attendance/repository.py`: locked transitions, history, corrections, and aggregate SQL.
- `backend/attendance/service.py`: QR validation, cooldown, idempotency, and statistics.
- `backend/attendance/router.py`: student and teacher attendance APIs.

### Next.js

- `src/app/login/page.tsx`: shared-device password and QR display states.
- `src/features/kiosk/kiosk-screen.tsx`: automatic cookie renewal and QR polling.
- `src/features/kiosk/qr-card.tsx`: QR rendering and countdown.
- `src/app/student/scan/page.tsx`: student camera scanner.
- `src/features/attendance/qr-scanner.tsx`: isolated ZXing/media-device adapter.
- `src/app/student/attendance/page.tsx`: personal history and statistics.
- `src/app/teacher/attendance/page.tsx`: filters, scan timeline, and corrections.
- `src/features/attendance/*`: reusable attendance cards, tables, and charts.

### Tests

- `tests/backend/test_kiosk_security.py`
- `tests/backend/test_kiosk_service.py`
- `tests/backend/test_kiosk_api.py`
- `tests/backend/test_attendance_service.py`
- `tests/backend/test_attendance_concurrency.py`
- `tests/backend/test_attendance_statistics.py`
- `src/features/kiosk/kiosk-screen.test.tsx`
- `src/features/attendance/qr-scanner.test.tsx`
- `src/app/student/attendance/page.test.tsx`
- `tests/e2e/attendance.spec.ts`
- `tests/e2e/helpers/attendance.ts`: QR extraction, scan submission, and test-clock helpers.

---

### Task 1: Kiosk and Attendance Database Schema

**Files:**
- Create via CLI: generated `supabase/migrations/*_attendance_core.sql`
- Test: `tests/backend/test_attendance_schema.py`

**Interfaces:**
- Consumes: identity schema and backend database role from the foundation plan.
- Produces: `kiosk_sessions`, `attendance_scans`, `rate_limit_buckets`, enums `attendance_direction` and `attendance_source`, and required indexes.

- [ ] **Step 1: Create the migration only through Supabase CLI**

Run: `npx supabase migration new attendance_core`

Expected: one generated migration path ending in `_attendance_core.sql`. Record that exact path and use it for this task without renaming it.

- [ ] **Step 2: Write a failing schema test**

```python
def test_attendance_constraints(connection):
    tables = {
        row[0] for row in connection.execute(
            "select table_name from information_schema.tables where table_schema = 'app'"
        )
    }
    assert {"kiosk_sessions", "attendance_scans", "rate_limit_buckets"} <= tables
    constraints = connection.execute(
        "select constraint_name from information_schema.table_constraints "
        "where table_schema = 'app' and table_name = 'attendance_scans'"
    ).fetchall()
    assert any("request" in row[0] for row in constraints)
```

- [ ] **Step 3: Run the test and verify failure**

Run: `uv run pytest tests/backend/test_attendance_schema.py -v`

Expected: FAIL because the three tables do not exist.

- [ ] **Step 4: Implement the migration**

```sql
create type app.attendance_direction as enum ('IN', 'OUT');
create type app.attendance_source as enum ('QR', 'MANUAL');

create table app.kiosk_sessions (
  id uuid primary key default gen_random_uuid(),
  refresh_token_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references app.user_profiles(user_id)
);

create table app.attendance_scans (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references app.student_profiles(user_id),
  attendance_date date not null,
  direction app.attendance_direction not null,
  scanned_at timestamptz not null,
  kiosk_session_id uuid references app.kiosk_sessions(id),
  request_id uuid not null,
  qr_issued_at timestamptz,
  source app.attendance_source not null default 'QR',
  recorded_by uuid references app.user_profiles(user_id),
  voided_at timestamptz,
  voided_by uuid references app.staff_memberships(user_id),
  void_reason text,
  unique (student_id, request_id)
);
```

Add `rate_limit_buckets` exactly as the spec defines, plus indexes on `(student_id, attendance_date, scanned_at)`, active kiosk expiry, and non-voided scans. Add checks that QR rows have kiosk/QR fields, manual rows have `recorded_by`, and void metadata is complete. Enable RLS and keep browser roles revoked.

- [ ] **Step 5: Apply and verify the migration**

Run:

```bash
npx supabase db reset
uv run pytest tests/backend/test_attendance_schema.py -v
npx supabase migration list --local
```

Expected: schema test passes and both identity and attendance migrations are applied.

- [ ] **Step 6: Commit schema**

```bash
git add supabase tests/backend/test_attendance_schema.py
git commit -m "feat: add attendance database schema"
```

### Task 2: Shared-Device Login and Renewable Sessions

**Files:**
- Modify: `pyproject.toml`
- Modify: `uv.lock`
- Create: `backend/core/clock.py`
- Create: `backend/core/rate_limit.py`
- Create: `backend/kiosk/schemas.py`
- Create: `backend/kiosk/repository.py`
- Create: `backend/kiosk/security.py`
- Create: `backend/kiosk/service.py`
- Create: `backend/kiosk/router.py`
- Modify: `backend/core/config.py`
- Modify: `backend/main.py`
- Test: `tests/backend/test_kiosk_security.py`
- Test: `tests/backend/test_kiosk_service.py`
- Test: `tests/backend/test_kiosk_api.py`

**Interfaces:**
- Consumes: `KIOSK_PASSWORD_HASH`, `KIOSK_COOKIE_SECRET`, database helper, rate-limit table.
- Produces: `POST /api/kiosk/sessions`, `POST /api/kiosk/sessions/refresh`, `DELETE /api/kiosk/sessions/current`, and `require_kiosk_session()` with a 15-minute access TTL and sliding 30-day refresh TTL.

- [ ] **Step 1: Add Argon2 and write failing security tests**

Add `argon2-cffi==25.1.0` to `pyproject.toml`, run `uv lock`, then create:

```python
def test_password_verification_does_not_accept_wrong_value(password_hasher):
    hashed = password_hasher.hash("church-kiosk-secret")
    assert password_hasher.verify(hashed, "church-kiosk-secret") is True
    assert password_hasher.verify(hashed, "wrong") is False

async def test_refresh_rotation_invalidates_previous_token(kiosk_service, kiosk_session):
    first = kiosk_session.refresh_token
    second = await kiosk_service.refresh(first)
    with pytest.raises(KioskSessionRevoked):
        await kiosk_service.refresh(first)
    assert second.refresh_token != first
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_kiosk_security.py tests/backend/test_kiosk_service.py -v`

Expected: FAIL because kiosk security and service modules do not exist.

- [ ] **Step 3: Implement secure session primitives**

```python
@dataclass(frozen=True)
class KioskTokens:
    access_token: str
    access_expires_at: datetime
    refresh_token: str
    refresh_expires_at: datetime

def hash_opaque_token(token: str, pepper: str) -> str:
    return hmac.new(pepper.encode(), token.encode(), hashlib.sha256).hexdigest()
```

Generate 32-byte opaque refresh tokens with `secrets.token_urlsafe(32)`. Store only the HMAC hash. Use a signed 15-minute access cookie containing session ID and expiry. Rotate refresh tokens transactionally, extend the valid replacement token to 30 days from the refresh time, reject expired/revoked/old tokens, update `last_seen_at`, and create durable rate-limit buckets for password failures keyed by a server-keyed hash of IP plus user-agent.

- [ ] **Step 4: Implement cookie endpoints**

Set access and refresh cookies as `HttpOnly`, `SameSite=Strict`, path `/`, and `Secure` outside local development. Refresh automatically returns replacement cookies. Cookie-authenticated mutations verify the request origin. Login failures return one generic Korean message and never reveal whether rate limiting or password comparison failed.

```python
def set_kiosk_cookies(response: Response, tokens: KioskTokens, secure: bool) -> None:
    response.set_cookie("kiosk_access", tokens.access_token, httponly=True, secure=secure, samesite="strict", max_age=900, path="/")
    response.set_cookie("kiosk_refresh", tokens.refresh_token, httponly=True, secure=secure, samesite="strict", max_age=2_592_000, path="/")
```

- [ ] **Step 5: Verify session behavior**

Run:

```bash
uv run pytest tests/backend/test_kiosk_security.py tests/backend/test_kiosk_service.py tests/backend/test_kiosk_api.py -v
uv run ruff check backend tests/backend
```

Expected: login, automatic rotation, old-token rejection, expiry, revoke, cookie flags, and rate-limit tests pass.

- [ ] **Step 6: Commit kiosk sessions**

```bash
git add pyproject.toml uv.lock backend tests/backend
git commit -m "feat: add renewable kiosk sessions"
```

### Task 3: Twenty-Second QR Challenge Issuance

**Files:**
- Modify: `backend/kiosk/schemas.py`
- Modify: `backend/kiosk/security.py`
- Modify: `backend/kiosk/service.py`
- Modify: `backend/kiosk/router.py`
- Modify: `backend/core/config.py`
- Test: `tests/backend/test_qr_tokens.py`
- Test: `tests/backend/test_kiosk_api.py`

**Interfaces:**
- Consumes: active kiosk session and `QR_SIGNING_SECRET`.
- Produces: `QrChallenge(kiosk_session_id, issued_at, expires_at, nonce)`, `issue_qr_challenge()`, `verify_qr_challenge()`, and `GET /api/kiosk/qr`.

- [ ] **Step 1: Write failing exact-time tests**

```python
def test_qr_is_valid_before_twenty_seconds(qr_codec, frozen_clock, kiosk_id):
    token = qr_codec.issue(kiosk_id)
    frozen_clock.advance(seconds=19, milliseconds=999)
    assert qr_codec.verify(token).kiosk_session_id == kiosk_id

def test_qr_expires_at_twenty_seconds(qr_codec, frozen_clock, kiosk_id):
    token = qr_codec.issue(kiosk_id)
    frozen_clock.advance(seconds=20)
    with pytest.raises(QrExpired):
        qr_codec.verify(token)
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_qr_tokens.py -v`

Expected: FAIL because the QR codec does not exist.

- [ ] **Step 3: Implement signed challenges**

```python
QR_LIFETIME = timedelta(seconds=20)

def issue(self, kiosk_session_id: UUID) -> str:
    issued_at = self.clock.now()
    payload = {
        "typ": "attendance-qr",
        "sid": str(kiosk_session_id),
        "iat": int(issued_at.timestamp()),
        "exp": int((issued_at + QR_LIFETIME).timestamp()),
        "jti": str(uuid4()),
    }
    return jwt.encode(payload, self.secret, algorithm="HS256")
```

Restrict verification to HS256, require every claim, check `typ`, verify signature with PyJWT, and compare the injected clock manually so `now >= exp` is rejected at the exact 20-second boundary. Then load the kiosk session to reject revoked or refresh-expired sessions. `GET /api/kiosk/qr` returns token, issued time, and expiry but no student data.

- [ ] **Step 4: Verify QR API and commit**

Run: `uv run pytest tests/backend/test_qr_tokens.py tests/backend/test_kiosk_api.py -v`

Expected: exact boundary, tampering, wrong type, missing claim, and revoked-session cases pass.

```bash
git add backend tests/backend
git commit -m "feat: issue short-lived attendance QR codes"
```

### Task 4: Atomic Alternating Attendance Scans

**Files:**
- Create: `backend/attendance/models.py`
- Create: `backend/attendance/schemas.py`
- Create: `backend/attendance/repository.py`
- Create: `backend/attendance/service.py`
- Create: `backend/attendance/router.py`
- Modify: `backend/main.py`
- Test: `tests/backend/test_attendance_service.py`
- Test: `tests/backend/test_attendance_concurrency.py`

**Interfaces:**
- Consumes: authenticated student, `verify_qr_challenge()`, and attendance tables.
- Produces: `ScanResult(direction, scanned_at, duplicate, cooldown_remaining)`, `POST /api/attendance/scan`, void/manual-correction repository methods.

- [ ] **Step 1: Write failing transition and retry tests**

```python
async def test_scans_alternate_after_cooldown(attendance_service, student, qr_token, clock):
    first = await attendance_service.scan(student, qr_token, uuid4())
    assert first.direction == Direction.IN
    clock.advance(seconds=10)
    second = await attendance_service.scan(student, qr_token, uuid4())
    assert second.direction == Direction.OUT

async def test_retry_returns_original_result(attendance_service, student, qr_token, request_id):
    first = await attendance_service.scan(student, qr_token, request_id)
    retry = await attendance_service.scan(student, qr_token, request_id)
    assert retry.scan_id == first.scan_id
    assert retry.duplicate is True
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_attendance_service.py tests/backend/test_attendance_concurrency.py -v`

Expected: FAIL because attendance domain modules do not exist.

- [ ] **Step 3: Implement one locked transition transaction**

```sql
select pg_advisory_xact_lock(hashtextextended(%(student_date_key)s, 0));
select id, direction, scanned_at
from app.attendance_scans
where student_id = %(student_id)s
  and attendance_date = %(attendance_date)s
  and voided_at is null
order by scanned_at desc, id desc
limit 1;
```

Within the same transaction, first check `(student_id, request_id)` for idempotency, then lock the student/date key, calculate the Seoul business date from server time, enforce `elapsed < 10 seconds` as cooldown, choose the opposite direction, and insert. Never use a client direction, timestamp, student ID, or kiosk ID.

- [ ] **Step 4: Add concurrency, void, and manual-correction behavior**

Run two scan requests concurrently and assert only one accepted transition plus one cooldown result. Teacher corrections either set void metadata on an existing row or append a `MANUAL` row with `recorded_by`; both operations and reasons write `audit_logs` entries.

```python
async def correct_scan(self, teacher: AuthenticatedUser, command: CorrectionCommand) -> AttendanceScan:
    async with self.repository.transaction() as transaction:
        corrected = await transaction.void_or_append_manual(command, actor_id=teacher.user_id)
        await transaction.append_audit("attendance.corrected", str(corrected.id), {"mode": command.mode, "reason": command.reason})
        return corrected
```

- [ ] **Step 5: Verify attendance domain**

Run:

```bash
uv run pytest tests/backend/test_attendance_service.py tests/backend/test_attendance_concurrency.py -v
uv run ruff check backend tests/backend
```

Expected: first scan `IN`, cooldown at 9.999 seconds, accepted reversal at 10 seconds, four-scan alternation, idempotent retry, and concurrent safety all pass.

- [ ] **Step 6: Commit atomic attendance**

```bash
git add backend tests/backend
git commit -m "feat: record atomic alternating attendance"
```

### Task 5: Attendance History and Statistics

**Files:**
- Modify: `backend/attendance/schemas.py`
- Modify: `backend/attendance/repository.py`
- Modify: `backend/attendance/service.py`
- Modify: `backend/attendance/router.py`
- Test: `tests/backend/test_attendance_statistics.py`
- Test: `tests/backend/test_attendance_api.py`

**Interfaces:**
- Consumes: accepted, non-voided attendance rows and statistics-inclusion flag.
- Produces: `GET /api/attendance/me`, `GET /api/statistics/me`, `GET /api/teacher/attendance`, `GET /api/teacher/statistics`, and correction endpoint.

- [ ] **Step 1: Write failing statistic tests**

```python
async def test_average_stay_uses_completed_pairs_only(statistics_service, student):
    await seed_scans(student, [
        ("IN", "09:00"), ("OUT", "10:00"),
        ("IN", "11:00"),
    ])
    result = await statistics_service.student_summary(student.user_id)
    assert result.average_stay_seconds == 3600
    assert result.currently_inside is True

async def test_excluded_student_is_absent_only_from_teacher_aggregate(statistics_service, excluded_student):
    assert (await statistics_service.student_summary(excluded_student.user_id)).attendance_days == 1
    assert (await statistics_service.teacher_summary()).unique_students_today == 0
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_attendance_statistics.py tests/backend/test_attendance_api.py -v`

Expected: FAIL because summary queries and endpoints do not exist.

- [ ] **Step 3: Implement paired-stay and aggregate queries**

Use SQL window functions to pair each non-voided `IN` with the immediately following non-voided `OUT`. Exclude unmatched `IN` rows from average duration but expose them as open stays. Teacher aggregates join `student_profiles` and filter `include_in_statistics = true`; teacher detail lists do not filter those students and return an exclusion flag.

```sql
with ordered as (
  select student_id, direction, scanned_at,
         lead(direction) over (partition by student_id order by scanned_at, id) as next_direction,
         lead(scanned_at) over (partition by student_id order by scanned_at, id) as next_scanned_at
  from app.attendance_scans
  where voided_at is null
)
select avg(extract(epoch from next_scanned_at - scanned_at))
from ordered where direction = 'IN' and next_direction = 'OUT';
```

- [ ] **Step 4: Implement role-scoped APIs and corrections**

Student endpoints always derive the student ID from JWT subject. Teacher endpoints accept validated date/status/search filters. Corrections require a non-empty reason, teacher role, and audit entry. Use stable response DTOs with ISO timestamps and explicit `Asia/Seoul` display dates.

```python
@router.get("/api/attendance/me", response_model=AttendanceHistoryPage)
async def my_history(user: AuthenticatedUser = Depends(get_current_user), service: AttendanceService = Depends(get_attendance_service)):
    return await service.student_history(user.user_id)

@router.get("/api/teacher/attendance", response_model=TeacherAttendancePage)
async def teacher_history(filters: AttendanceFilters = Depends(), teacher: AuthenticatedUser = Depends(require_teacher), service: AttendanceService = Depends(get_attendance_service)):
    return await service.teacher_history(filters)
```

- [ ] **Step 5: Verify statistics and commit**

Run: `uv run pytest tests/backend/test_attendance_statistics.py tests/backend/test_attendance_api.py -v`

Expected: personal and teacher summaries, excluded-student behavior, open stays, filters, and corrections pass.

```bash
git add backend tests/backend
git commit -m "feat: add attendance history and statistics"
```

### Task 6: Kiosk Display and Student QR Scanner

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/app/login/page.tsx`
- Create: `src/features/kiosk/kiosk-screen.tsx`
- Create: `src/features/kiosk/qr-card.tsx`
- Create: `src/app/student/scan/page.tsx`
- Create: `src/features/attendance/qr-scanner.tsx`
- Test: `src/features/kiosk/kiosk-screen.test.tsx`
- Test: `src/features/attendance/qr-scanner.test.tsx`

**Interfaces:**
- Consumes: kiosk session/QR endpoints, student access token, `POST /api/attendance/scan`.
- Produces: shared-device QR UI, automatic session refresh, camera scanning, and accepted/cooldown/error result states.

- [ ] **Step 1: Add QR dependencies and write failing component tests**

Pin `qrcode` to `1.5.4`, `@types/qrcode` to `1.5.6`, and `@zxing/browser` to `0.2.1` in `package.json`, then run `npm install`.

```tsx
it("refreshes QR before the twenty-second expiry", async () => {
  vi.useFakeTimers();
  render(<KioskScreen />);
  await screen.findByText("20초 후 갱신");
  await vi.advanceTimersByTimeAsync(15_000);
  expect(mockApi.get).toHaveBeenCalledTimes(2);
});

it("submits one request id for a decoded QR", async () => {
  render(<QrScanner decoder={fakeDecoder("signed-qr")} />);
  await waitFor(() => expect(mockApi.post).toHaveBeenCalledWith(
    "/api/attendance/scan",
    expect.objectContaining({ qr_token: "signed-qr", request_id: expect.any(String) }),
  ));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/features/kiosk/kiosk-screen.test.tsx src/features/attendance/qr-scanner.test.tsx`

Expected: FAIL because kiosk and scanner components do not exist.

- [ ] **Step 3: Implement shared-device UI**

`/login` begins with the shared-password form. After success, render QR canvas, expiry countdown, connection status, and a discreet device-session reset action. Request a replacement at 15 seconds so a network delay does not leave a gap before the 20-second hard expiry. A 401 refresh failure returns to the password form; automatic refresh never exposes tokens to JavaScript because cookies are HttpOnly.

```tsx
useEffect(() => {
  if (state !== "unlocked") return;
  void refreshQr();
  const timer = window.setInterval(refreshQr, 15_000);
  return () => window.clearInterval(timer);
}, [state, refreshQr]);
```

- [ ] **Step 4: Implement isolated scanner UI**

Use ZXing behind an adapter so tests can inject a fake decoder. Request the environment-facing camera, stop tracks on unmount, pause decode while a scan is being submitted, reuse the same request ID for retries of that decoded value, and display distinct Korean recovery states for permission denial, unsupported camera, invalid QR, expired QR, cooldown, and accepted `IN`/`OUT`.

```ts
export interface QrDecoder {
  start(video: HTMLVideoElement, onDecoded: (value: string) => void): Promise<() => void>;
}

export type ScanUiState = "requesting-camera" | "scanning" | "submitting" | "accepted-in" | "accepted-out" | "cooldown" | "error";
```

- [ ] **Step 5: Verify UI and commit**

Run:

```bash
npm test -- src/features/kiosk/kiosk-screen.test.tsx src/features/attendance/qr-scanner.test.tsx
npm run typecheck
npm run lint
```

Expected: polling, cookie refresh responses, camera cleanup, retry idempotency, and all status messages pass.

```bash
git add package.json package-lock.json src
git commit -m "feat: add kiosk QR and student scanner"
```

### Task 7: Attendance Screens and Full Flow Verification

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/app/student/attendance/page.tsx`
- Create: `src/app/teacher/attendance/page.tsx`
- Create: `src/features/attendance/summary-cards.tsx`
- Create: `src/features/attendance/history-list.tsx`
- Create: `src/features/attendance/attendance-table.tsx`
- Create: `src/features/attendance/stay-chart.tsx`
- Test: `src/app/student/attendance/page.test.tsx`
- Test: `src/app/teacher/attendance/page.test.tsx`
- Test: `tests/e2e/attendance.spec.ts`
- Create: `tests/e2e/helpers/attendance.ts`

**Interfaces:**
- Consumes: attendance history/statistics/correction APIs.
- Produces: responsive student history, teacher attendance table/cards, and verified kiosk-to-dashboard flow.

- [ ] **Step 1: Add chart dependency and write failing page tests**

Pin `recharts` to `3.10.1`, run `npm install`, and test that the student page renders attendance days, total entries, average completed stay, current open stay, and recent scan rows. Test that the teacher page preserves filters in URL search parameters and shows a `통계 제외` badge without hiding the student.

- [ ] **Step 2: Run component tests and verify failure**

Run: `npm test -- src/app/student/attendance/page.test.tsx src/app/teacher/attendance/page.test.tsx`

Expected: FAIL because attendance pages and components do not exist.

- [ ] **Step 3: Implement responsive attendance views**

Use cards and timeline rows on mobile; use summary cards, filter controls, table, and detail drawer on desktop. Render server timestamps in `Asia/Seoul`. Correction controls require a reason and display void/manual records without pretending the original QR row disappeared.

```tsx
return (
  <section>
    <SummaryCards summary={summary} />
    <div className="md:hidden"><HistoryList scans={scans} /></div>
    <div className="hidden md:block"><AttendanceTable scans={scans} /></div>
  </section>
);
```

- [ ] **Step 4: Write and run the browser flow**

```ts
test("kiosk scan alternates and appears in teacher history", async ({ browser }) => {
  const kiosk = await browser.newPage();
  const student = await browser.newPage();
  await unlockKiosk(kiosk);
  const token = await readRenderedQrToken(kiosk);
  await submitDecodedQr(student, token, "00000000-0000-4000-8000-000000000001");
  await expect(student.getByText("입실 처리되었습니다")).toBeVisible();
  await advanceTestClock(10_000);
  await submitDecodedQr(student, token, "00000000-0000-4000-8000-000000000002");
  await expect(student.getByText("퇴실 처리되었습니다")).toBeVisible();
});
```

Create `tests/e2e/helpers/attendance.ts` exporting `readRenderedQrToken(page): Promise<string>`, `submitDecodedQr(page, token, requestId): Promise<void>`, and `advanceTestClock(milliseconds): Promise<void>`. Back these helpers with a test-only signed QR fixture guarded by `APP_ENV=test`; production code paths must reject fixture headers.

- [ ] **Step 5: Run milestone verification**

Run:

```bash
npm test
uv run pytest tests/backend -v
npm run typecheck
npm run lint
npm run build
npm run test:e2e -- tests/e2e/attendance.spec.ts
```

Expected: all checks pass. Manually verify one real camera scan on localhost and one kiosk revocation from an administrator session.

- [ ] **Step 6: Commit verified attendance milestone**

```bash
git add package.json package-lock.json src tests/e2e
git commit -m "feat: complete QR attendance flow"
```
