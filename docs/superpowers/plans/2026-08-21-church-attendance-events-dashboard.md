# Church Attendance Events and Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete weekly events, responsive student/teacher dashboards, student statistics controls, administrator operations, security verification, and the final local Vercel-shaped user flow.

**Architecture:** FastAPI expands one-time and weekly event series, supplies teacher dashboards, and remains the authorization authority. Next.js applies the approved student QR-first mobile layout and teacher sidebar/table layout, adapting tables to cards on smaller screens and using bounded polling instead of durable in-memory or WebSocket state.

**Tech Stack:** Foundation and QR-attendance plan stacks, Python `zoneinfo`, React server/client components, Tailwind CSS, Vitest, pytest, Playwright, Supabase CLI database lint and advisors, Vercel CLI local runtime

**Spec:** `docs/superpowers/specs/2026-08-21-church-attendance-system-design.md`

## Global Constraints

- Complete the foundation/identity plan and QR/attendance plan first.
- Events support one-time and whole-series weekly recurrence only; no single-occurrence exceptions.
- Event recurrence and all display/business dates use `Asia/Seoul`.
- Events never determine or partition attendance.
- Students are self-registered only; no teacher `학생 추가` action exists.
- A statistics-excluded student remains visible and editable, can log in and scan, and keeps personal statistics.
- Root `/` contains only the teacher and student login choices; kiosk entry remains `/login`.
- Preserve the approved visual hierarchy: student QR action first, teacher summary plus attendance table first.
- Keep administrator-only routes hidden for convenience and protected again in FastAPI for security.
- Use visibility-aware dashboard polling at intervals of at least 30 seconds with cleanup and retry backoff; do not hold durable state in Vercel function memory.
- Keep all FastAPI routes short-lived and free of background schedulers/WebSockets so the final build remains within the Vercel Hobby Function and invocation envelope documented by the spec.
- Finish with actual local browser, camera, database, build, and `vercel dev` verification.

## File Structure

### Events backend and database

- Generated `supabase/migrations/*_events.sql`: event table, checks, indexes, and grants.
- `backend/events/models.py`: event and occurrence domain types.
- `backend/events/schemas.py`: create/update/query DTOs.
- `backend/events/repository.py`: event-series persistence.
- `backend/events/recurrence.py`: Seoul weekly occurrence expansion.
- `backend/events/service.py`: validation and role-scoped operations.
- `backend/events/router.py`: student read and teacher CRUD endpoints.

### Dashboard backend

- `backend/students/schemas.py`: teacher student-row/edit DTOs.
- `backend/students/repository.py`: student listing, search, editing, and inclusion update.
- `backend/students/service.py`: authorization and audit operations.
- `backend/students/router.py`: `/api/teacher/students/*`.
- `backend/dashboard/schemas.py`: combined teacher summary DTO.
- `backend/dashboard/service.py`: summary composition.
- `backend/dashboard/router.py`: `/api/teacher/dashboard`.
- `backend/admin/router.py`: finalized application, staff, and kiosk administration APIs.

### Responsive frontend

- `src/app/student/layout.tsx`: student navigation shell.
- `src/app/student/page.tsx`: approved QR-first home.
- `src/app/student/events/page.tsx`: current/adjacent week events.
- `src/app/teacher/layout.tsx`: teacher/admin responsive sidebar and drawer.
- `src/app/teacher/page.tsx`: approved attendance-first dashboard.
- `src/app/teacher/students/page.tsx`: student table/cards and editor.
- `src/app/teacher/events/page.tsx`: event-series management.
- `src/app/teacher/applications/page.tsx`: polished administrator-only application queue.
- `src/app/admin/staff/page.tsx`: polished staff roles.
- `src/app/admin/kiosks/page.tsx`: kiosk revocation.
- `src/components/navigation/*`: role-aware responsive navigation.
- `src/features/events/*`: event cards, forms, and recurrence controls.
- `src/features/students/*`: table/cards, profile editor, inclusion control.
- `src/features/dashboard/*`: summary cards and bounded polling.

### Tests and operations

- `tests/backend/test_event_recurrence.py`
- `tests/backend/test_event_api.py`
- `tests/backend/test_student_management.py`
- `tests/backend/test_dashboard.py`
- `src/features/events/event-form.test.tsx`
- `src/app/student/page.test.tsx`
- `src/app/teacher/page.test.tsx`
- `src/app/teacher/students/page.test.tsx`
- `tests/e2e/full-system.spec.ts`
- `tests/e2e/helpers/system.ts`: composed student, staff, kiosk, event, and statistics browser helpers.
- `docs/local-development.md`

---

### Task 1: Event Schema and Weekly Recurrence Domain

**Files:**
- Create via CLI: generated `supabase/migrations/*_events.sql`
- Create: `backend/events/models.py`
- Create: `backend/events/schemas.py`
- Create: `backend/events/repository.py`
- Create: `backend/events/recurrence.py`
- Create: `backend/events/service.py`
- Create: `backend/events/router.py`
- Modify: `backend/main.py`
- Test: `tests/backend/test_event_recurrence.py`
- Test: `tests/backend/test_event_api.py`

**Interfaces:**
- Consumes: `require_teacher`, authenticated student, database helper, `Asia/Seoul` configuration.
- Produces: `EventSeries`, `EventOccurrence`, `expand_weekly_occurrences()`, `GET /api/events`, and teacher event CRUD.

- [ ] **Step 1: Create the migration through Supabase CLI**

Run: `npx supabase migration new events`

Expected: one generated path ending in `_events.sql`. Record and edit that generated path without renaming it.

- [ ] **Step 2: Write failing recurrence tests**

```python
def test_weekly_series_expands_in_seoul_time():
    series = EventSeries(
        id=UUID("00000000-0000-4000-8000-000000000001"),
        title="주일예배",
        starts_at=datetime(2026, 8, 23, 2, 0, tzinfo=timezone.utc),
        ends_at=datetime(2026, 8, 23, 3, 30, tzinfo=timezone.utc),
        repeat_weekly=True,
        repeat_until=date(2026, 9, 6),
    )
    occurrences = expand_weekly_occurrences(series, date(2026, 8, 31), date(2026, 9, 7))
    assert [item.local_start.date() for item in occurrences] == [date(2026, 9, 6)]
    assert occurrences[0].local_start.hour == 11

def test_one_time_event_outside_range_is_not_returned():
    assert expand_weekly_occurrences(one_time_event, date(2026, 9, 1), date(2026, 9, 7)) == []
```

- [ ] **Step 3: Run recurrence tests and verify failure**

Run: `uv run pytest tests/backend/test_event_recurrence.py -v`

Expected: FAIL because event domain and recurrence modules do not exist.

- [ ] **Step 4: Implement event migration and recurrence**

```sql
create table app.events (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  repeat_weekly boolean not null default false,
  repeat_until date,
  created_by uuid not null references app.staff_memberships(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (repeat_weekly or repeat_until is null)
);
```

Implement recurrence using `ZoneInfo("Asia/Seoul")`: convert the stored first occurrence to Seoul local time, advance in exact seven-day steps, stop after `repeat_until`, preserve duration, and return occurrences intersecting `[range_start, range_end)`. Do not generate or persist occurrence rows.

```python
SEOUL = ZoneInfo("Asia/Seoul")

def expand_weekly_occurrences(series: EventSeries, range_start: date, range_end: date) -> list[EventOccurrence]:
    local_start = series.starts_at.astimezone(SEOUL)
    duration = series.ends_at - series.starts_at
    cursor = local_start
    occurrences: list[EventOccurrence] = []
    while cursor.date() < range_end:
        if series.repeat_until is not None and cursor.date() > series.repeat_until:
            break
        if range_start <= cursor.date() < range_end:
            occurrences.append(EventOccurrence(
                occurrence_id=f"{series.id}:{cursor.date().isoformat()}",
                event_id=series.id,
                title=series.title,
                local_start=cursor,
                local_end=cursor + duration,
                location=series.location,
            ))
        if not series.repeat_weekly:
            break
        cursor += timedelta(days=7)
    return occurrences
```

- [ ] **Step 5: Implement event APIs and verify**

Students can request a maximum 42-day range. Teachers can create/update/delete full series. Validate title, end after start, repeat end not before first occurrence, and return 404 without exposing nonexistent IDs.

```python
@router.get("/api/events", response_model=list[EventOccurrenceView])
async def list_events(date_range: EventRange = Depends(), user: AuthenticatedUser = Depends(get_current_user), service: EventService = Depends(get_event_service)):
    return await service.occurrences(date_range.start, date_range.end)

@router.post("/api/teacher/events", response_model=EventSeriesView, status_code=201)
async def create_event(command: EventCreate, teacher: AuthenticatedUser = Depends(require_teacher), service: EventService = Depends(get_event_service)):
    return await service.create(command, teacher.user_id)
```

Run:

```bash
npx supabase db reset
uv run pytest tests/backend/test_event_recurrence.py tests/backend/test_event_api.py -v
```

Expected: recurrence boundaries, indefinite weekly series, one-time events, validation, and teacher authorization pass.

- [ ] **Step 6: Commit events domain**

```bash
git add supabase backend/events backend/main.py tests/backend
git commit -m "feat: add recurring church events"
```

### Task 2: Student Weekly Events Experience

**Files:**
- Create: `src/features/events/event-card.tsx`
- Create: `src/features/events/week-navigation.tsx`
- Create: `src/app/student/events/page.tsx`
- Modify: `src/app/student/page.tsx`
- Test: `src/app/student/events/page.test.tsx`
- Test: `src/app/student/page.test.tsx`

**Interfaces:**
- Consumes: `GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD` occurrence DTOs.
- Produces: current-week home preview and accessible adjacent-week event list.

- [ ] **Step 1: Write failing event UI tests**

```tsx
it("groups this week's events by Seoul date", async () => {
  mockApi.get.mockResolvedValue([
    { id: "event-1:2026-08-23", title: "주일예배", local_start: "2026-08-23T11:00:00+09:00", location: "본당" },
  ]);
  render(<StudentEventsPage searchParams={Promise.resolve({ week: "2026-08-17" })} />);
  expect(await screen.findByText("8월 23일 일요일")).toBeVisible();
  expect(screen.getByText("주일예배")).toBeVisible();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/app/student/events/page.test.tsx src/app/student/page.test.tsx`

Expected: FAIL because event pages/components do not exist.

- [ ] **Step 3: Implement student event cards and week navigation**

Use semantic lists and `<time>` elements. The student home shows the next two occurrences in the current week below attendance statistics. The events page accepts a validated Monday `week` query, requests seven local dates, and provides previous/current/next week controls. Empty state says `이번 주 등록된 일정이 없습니다.`

```tsx
return events.length ? (
  <ul>{events.map((event) => <li key={event.occurrence_id}><EventCard event={event} /></li>)}</ul>
) : <p>이번 주 등록된 일정이 없습니다.</p>;
```

- [ ] **Step 4: Verify and commit student events**

Run:

```bash
npm test -- src/app/student/events/page.test.tsx src/app/student/page.test.tsx
npm run typecheck
npm run lint
```

Expected: grouping, week navigation, empty state, and responsive semantics pass.

```bash
git add src
git commit -m "feat: show weekly events to students"
```

### Task 3: Teacher Event Management

**Files:**
- Create: `src/features/events/event-form.tsx`
- Create: `src/features/events/event-list.tsx`
- Create: `src/app/teacher/events/page.tsx`
- Test: `src/features/events/event-form.test.tsx`
- Test: `src/app/teacher/events/page.test.tsx`

**Interfaces:**
- Consumes: teacher event CRUD endpoints.
- Produces: create/edit/delete whole-series UI with one-time and weekly options.

- [ ] **Step 1: Write failing form tests**

```tsx
it("submits a weekly event with an optional end date", async () => {
  render(<EventForm />);
  await user.type(screen.getByLabelText("제목"), "주일예배");
  await user.type(screen.getByLabelText("시작"), "2026-08-23T11:00");
  await user.type(screen.getByLabelText("종료"), "2026-08-23T12:30");
  await user.click(screen.getByLabelText("매주 반복"));
  await user.type(screen.getByLabelText("반복 종료일"), "2026-12-27");
  await user.click(screen.getByRole("button", { name: "일정 저장" }));
  expect(mockApi.post).toHaveBeenCalledWith("/api/teacher/events", expect.objectContaining({ repeat_weekly: true }));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm test -- src/features/events/event-form.test.tsx src/app/teacher/events/page.test.tsx`

Expected: FAIL because management UI does not exist.

- [ ] **Step 3: Implement event-series management**

Use Zod plus React Hook Form. Convert `datetime-local` values from Seoul time to ISO instants before submission. Editing clearly states `반복 일정 전체가 변경됩니다.` Deletion requires confirmation and removes the full series. Disable repeat end date for one-time events and show inline server validation messages.

```ts
const eventSchema = z.object({
  title: z.string().trim().min(1).max(120),
  startsAtLocal: z.string().min(1),
  endsAtLocal: z.string().min(1),
  repeatWeekly: z.boolean(),
  repeatUntil: z.string().optional(),
}).refine((value) => new Date(value.endsAtLocal) > new Date(value.startsAtLocal), { path: ["endsAtLocal"], message: "종료 시간은 시작 시간보다 늦어야 합니다." });
```

- [ ] **Step 4: Verify and commit event management**

Run: `npm test -- src/features/events/event-form.test.tsx src/app/teacher/events/page.test.tsx && npm run typecheck && npm run lint`

Expected: one-time, weekly, indefinite series, validation, edit warning, and delete confirmation pass.

```bash
git add src
git commit -m "feat: manage recurring events"
```

### Task 4: Teacher Student Management and Statistics Inclusion

**Files:**
- Create: `backend/students/schemas.py`
- Create: `backend/students/repository.py`
- Create: `backend/students/service.py`
- Create: `backend/students/router.py`
- Modify: `backend/main.py`
- Create: `src/features/students/student-table.tsx`
- Create: `src/features/students/student-cards.tsx`
- Create: `src/features/students/student-editor.tsx`
- Create: `src/app/teacher/students/page.tsx`
- Test: `tests/backend/test_student_management.py`
- Test: `src/app/teacher/students/page.test.tsx`

**Interfaces:**
- Consumes: identity tables, `require_teacher`, audit repository.
- Produces: paginated student listing/edit APIs and statistics inclusion toggle.

- [ ] **Step 1: Write failing service and page tests**

```python
async def test_statistics_exclusion_does_not_disable_student(student_service, teacher, student):
    updated = await student_service.set_statistics_inclusion(teacher, student.user_id, False)
    assert updated.include_in_statistics is False
    assert await student_service.can_student_use_account(student.user_id) is True
```

```tsx
it("has no teacher-created student action", async () => {
  render(<TeacherStudentsPage />);
  expect(await screen.findByRole("table")).toBeVisible();
  expect(screen.queryByRole("button", { name: "학생 추가" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_student_management.py -v && npm test -- src/app/teacher/students/page.test.tsx`

Expected: FAIL because student-management API and UI do not exist.

- [ ] **Step 3: Implement teacher student APIs**

List self-registered students with validated `query`, inclusion status, cursor, and page size at most 100. Teachers may update name, birth date, student phone, guardian phone, and `include_in_statistics`. Each change writes old/new field names, but not duplicated phone values, to `audit_logs`. No endpoint creates or disables auth accounts.

```python
@router.patch("/api/teacher/students/{student_id}", response_model=TeacherStudentView)
async def update_student(student_id: UUID, command: TeacherStudentUpdate, teacher: AuthenticatedUser = Depends(require_teacher), service: StudentService = Depends(get_student_service)):
    return await service.update(student_id, command, actor_id=teacher.user_id)
```

- [ ] **Step 4: Implement responsive table/cards**

Desktop shows name, calculated age, phone, guardian phone, statistics status, and edit action. Mobile renders the same information as cards. Use `통계 포함` and `통계 제외` labels, explain that exclusion does not block login or scanning, and preserve search/filter state in URL parameters.

```tsx
<>
  <div className="hidden md:block"><StudentTable students={students} /></div>
  <div className="grid gap-3 md:hidden"><StudentCards students={students} /></div>
</>
```

- [ ] **Step 5: Verify and commit student management**

Run:

```bash
uv run pytest tests/backend/test_student_management.py -v
npm test -- src/app/teacher/students/page.test.tsx
npm run typecheck
npm run lint
```

Expected: profile edits, audit records, statistics toggle, URL filters, responsive rendering, and absence of student creation pass.

```bash
git add backend src tests/backend
git commit -m "feat: manage self-registered students"
```

### Task 5: Approved Responsive Dashboard Shells

**Files:**
- Create: `backend/dashboard/schemas.py`
- Create: `backend/dashboard/service.py`
- Create: `backend/dashboard/router.py`
- Modify: `backend/main.py`
- Create: `src/components/navigation/student-navigation.tsx`
- Create: `src/components/navigation/teacher-navigation.tsx`
- Create: `src/app/student/layout.tsx`
- Modify: `src/app/student/page.tsx`
- Create: `src/app/teacher/layout.tsx`
- Create: `src/app/teacher/page.tsx`
- Create: `src/features/dashboard/use-dashboard-polling.ts`
- Create: `src/features/dashboard/teacher-summary.tsx`
- Test: `tests/backend/test_dashboard.py`
- Test: `src/app/student/page.test.tsx`
- Test: `src/app/teacher/page.test.tsx`

**Interfaces:**
- Consumes: student statistics/events and teacher attendance/statistics APIs.
- Produces: approved student QR-first home, teacher sidebar dashboard, mobile adaptations, and `GET /api/teacher/dashboard`.

- [ ] **Step 1: Write failing dashboard tests**

```tsx
it("places QR attendance before statistics and events", async () => {
  render(<StudentHomePage />);
  const qr = await screen.findByRole("link", { name: "QR로 출결하기" });
  const statistics = screen.getByText("나의 이번 달");
  expect(qr.compareDocumentPosition(statistics) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("stops teacher polling when unmounted", async () => {
  vi.useFakeTimers();
  const view = render(<TeacherDashboard />);
  view.unmount();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mockApi.get).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_dashboard.py -v && npm test -- src/app/student/page.test.tsx src/app/teacher/page.test.tsx`

Expected: FAIL because dashboard composition and navigation shells are absent.

- [ ] **Step 3: Implement combined teacher dashboard API**

Return today attendees, currently inside, current-week attendees, statistics-target student count, and recent attendance rows in one response. Reuse attendance/statistics services rather than duplicate SQL. The endpoint requires teacher membership and excludes statistics-disabled students only from aggregate cards.

```python
class TeacherDashboardView(BaseModel):
    today_attendees: int
    currently_inside: int
    week_attendees: int
    statistics_target_students: int
    recent_attendance: list[TeacherAttendanceRow]
```

- [ ] **Step 4: Implement approved responsive layouts**

Student mobile order is greeting, today's attendance state, primary QR action, monthly statistics, weekly events, and bottom navigation. Teacher desktop uses the approved dark sidebar, summary cards, filters, and recent table; mobile uses a drawer and row cards. Administrator menu entries render only for administrators. The teacher dashboard has no `학생 추가` button.

```tsx
<main>
  <TodayAttendanceCard />
  <Link href="/student/scan" className="primary-action">QR로 출결하기</Link>
  <StudentMonthlySummary />
  <CurrentWeekEvents />
</main>
```

- [ ] **Step 5: Implement bounded polling and verify**

Poll the teacher dashboard every 30 seconds only while the tab is visible; cancel the timer and in-flight request on unmount. Show the last successful data during a transient refresh failure and an accessible stale-data notice.

```ts
useEffect(() => {
  if (document.visibilityState !== "visible") return;
  const controller = new AbortController();
  const timer = window.setInterval(() => refresh({ signal: controller.signal }), 30_000);
  return () => { controller.abort(); window.clearInterval(timer); };
}, [refresh, visibilityKey]);
```

Run:

```bash
uv run pytest tests/backend/test_dashboard.py -v
npm test -- src/app/student/page.test.tsx src/app/teacher/page.test.tsx
npm run typecheck
npm run lint
```

Expected: ordering, route visibility, desktop/mobile structure, role menus, polling cleanup, and stale-data behavior pass.

- [ ] **Step 6: Commit dashboards**

```bash
git add backend src tests/backend
git commit -m "feat: add responsive attendance dashboards"
```

### Task 6: Administrator Operations and Security Audit

**Files:**
- Modify: `backend/identity/router.py`
- Modify: `backend/kiosk/router.py`
- Create: `backend/admin/router.py`
- Modify: `backend/main.py`
- Modify: `src/app/teacher/applications/page.tsx`
- Modify: `src/app/admin/staff/page.tsx`
- Create: `src/app/admin/kiosks/page.tsx`
- Test: `tests/backend/test_admin_api.py`
- Test: `src/app/admin/kiosks/page.test.tsx`

**Interfaces:**
- Consumes: identity approval/role services, kiosk repository, audit logging.
- Produces: finalized administrator application, staff-role, and kiosk-revocation operations.

- [ ] **Step 1: Write failing administrator security tests**

```python
@pytest.mark.parametrize("path", [
    "/api/admin/teacher-applications",
    "/api/admin/staff",
    "/api/admin/kiosk-sessions",
])
async def test_teacher_cannot_call_admin_endpoints(teacher_client, path):
    response = await teacher_client.get(path)
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "FORBIDDEN"
```

Add tests for kiosk revocation, last-admin protection through the API, application race handling, redacted audit details, cookie origin checks, and rate-limit bucket expiry.

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_admin_api.py -v && npm test -- src/app/admin/kiosks/page.test.tsx`

Expected: FAIL until the consolidated router and kiosk administration page exist.

- [ ] **Step 3: Implement administrator APIs and screens**

Use `require_admin` on every route. Approval and role changes call the already-tested services. Kiosk list returns session ID, created/last-seen/expiry/revoked timestamps only; never return refresh hashes, cookies, raw IPs, or user-agent values. Revocation is idempotent and immediately invalidates QR issuance.

```python
@router.delete("/api/admin/kiosk-sessions/{session_id}", status_code=204)
async def revoke_kiosk(session_id: UUID, admin: AuthenticatedUser = Depends(require_admin), service: KioskService = Depends(get_kiosk_service)) -> None:
    await service.revoke(session_id, revoked_by=admin.user_id)
```

- [ ] **Step 4: Run database security tooling**

First discover the installed CLI interface:

```bash
npx supabase db lint --help
npx supabase db advisors --help
```

Then run the verified commands:

```bash
npx supabase db lint --local --schema app --level warning --fail-on warning
npx supabase db advisors --local --type security --level warn --fail-on warn
npx supabase db advisors --local --type performance --level warn --fail-on warn
```

Expected: no unresolved warning or error. Add indexes or grants through a new CLI-created migration, reset the DB, and rerun if an advisor reports a valid issue.

- [ ] **Step 5: Verify and commit administrator hardening**

Run:

```bash
uv run pytest tests/backend/test_admin_api.py -v
npm test -- src/app/admin/kiosks/page.test.tsx
uv run ruff check backend tests/backend
npm run typecheck
```

Expected: authorization, redaction, revocation, audit, rate-limit, and UI tests pass.

```bash
git add backend src tests supabase
git commit -m "feat: harden administrator operations"
```

### Task 7: Full Local Flow and Vercel-Shaped Completion

**Files:**
- Create: `tests/e2e/full-system.spec.ts`
- Create: `tests/e2e/helpers/system.ts`
- Create: `docs/local-development.md`
- Modify: `README.md`
- Modify: `.env.example`
- Modify: `vercel.json`

**Interfaces:**
- Consumes: all three plans.
- Produces: reproducible local setup, complete browser verification, and Vercel-compatible final build.

- [ ] **Step 1: Write the complete failing browser journey**

Create `tests/e2e/helpers/system.ts` exporting these exact functions before writing the journey: `createVerifiedStudent(browser, email)`, `submitTeacherApplication(browser, email)`, `approveTeacherAndPromoteAdmin(browser, applicant)`, `unlockSharedDevice(browser)`, `scanKioskQr(studentPage, kioskPage)`, `expectTeacherAttendance(browser, email, state)`, `excludeStudentFromAggregates(browser, email)`, `createWeeklyEvent(browser, title)`, and `revokeKiosk(browser, kioskPage)`.

```ts
test("student, teacher, kiosk, attendance, statistics, and events work together", async ({ browser }) => {
  const student = await createVerifiedStudent(browser, "student@example.test");
  const applicant = await submitTeacherApplication(browser, "teacher@example.test");
  await approveTeacherAndPromoteAdmin(browser, applicant);
  const kiosk = await unlockSharedDevice(browser);
  await scanKioskQr(student, kiosk);
  await expect(student.getByText("입실 처리되었습니다")).toBeVisible();
  await expectTeacherAttendance(browser, "student@example.test", "입실 중");
  await excludeStudentFromAggregates(browser, "student@example.test");
  await expect(student.getByText("이번 달 출석 일수")).toBeVisible();
  await createWeeklyEvent(browser, "주일예배");
  await expect(student.getByText("주일예배")).toBeVisible();
  await revokeKiosk(browser, kiosk);
  await expect(kiosk.getByText("비치 기기 비밀번호")).toBeVisible();
});
```

- [ ] **Step 2: Run the journey and verify remaining failures**

Run: `npm run test:e2e -- tests/e2e/full-system.spec.ts`

Expected: FAIL on any incomplete cross-domain wiring; record each failure against its owning module before changing code.

- [ ] **Step 3: Complete only cross-domain wiring and local documentation**

Fix route links, response mapping, loading/error states, and test fixtures revealed by the journey without adding new features. Document Docker, Node 22, Python 3.12 through uv, Supabase CLI, npm/uv install, Supabase start/reset, Google OAuth local callback, Inbucket email verification, initial admin bootstrap, Argon2 hash generation, QR/cookie secrets, separate development servers, and `vercel dev`.

```bash
uv run python -c 'from argon2 import PasswordHasher; print(PasswordHasher().hash(input("Kiosk password: ")))'
openssl rand -base64 48
```

Document the first command as the local kiosk-hash generator and the second as the generator for separate QR and cookie signing secrets; users must run it independently for each secret.

- [ ] **Step 4: Run all automated verification**

Run:

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
```

Expected: every command exits zero.

- [ ] **Step 5: Verify actual local runtime flows**

Run `npm run vercel:dev`, then verify:

- root teacher/student choices;
- actual Google OAuth callback with configured local credentials;
- actual email confirmation through local Inbucket;
- actual mobile camera or webcam scan;
- 20-second QR expiry and 10-second cooldown;
- four alternating scans;
- teacher table and dashboard refresh;
- statistics exclusion without access loss;
- weekly recurring event display;
- kiosk automatic cookie renewal and administrator revocation.

- [ ] **Step 6: Commit the complete local system**

```bash
git add README.md docs/local-development.md .env.example vercel.json tests/e2e src backend
git commit -m "test: verify complete church attendance system"
```
