# Unified Account and Teacher Promotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace separate teacher signup/login with one student-first account flow and let administrators promote an existing student to teacher from student management.

**Architecture:** All auth methods converge on `/auth/continue`, which calls `/api/me` and routes by onboarding and database-backed capabilities. Staff authorization depends only on `app.staff_memberships`; promotion is an admin-only, audited, idempotent transaction that preserves the student profile.

**Tech Stack:** Next.js 16 App Router, React 19, shadcn/ui, TypeScript 6, Supabase Auth/SSR, FastAPI, Pydantic, psycopg 3, PostgreSQL, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-24-unified-account-role-promotion-design.md`

## Global Constraints

- Keep one responsive implementation for mobile, tablet, and desktop.
- Every new account starts as a student and completes student onboarding.
- Preserve existing users, student profiles, attendance history, staff memberships, and audit logs.
- Promoted password and Google accounts have the same teacher authorization.
- Initial-admin bootstrap still requires the configured verified Google identity.
- Keep historic teacher-application tables and backend endpoints; remove first-party frontend callers only.
- Keep FastAPI stateless and compatible with Vercel Python functions.
- Use tests first and observe the expected failure before production edits.
- Do not commit or push; use local diff checkpoints instead.

---

### Task 1: Unified Entry and Role-Aware Continuation

**Files:**
- Create: `src/app/auth/continue/page.tsx`
- Create: `src/app/auth/continue/page.test.tsx`
- Modify: `src/app/page.tsx`, `src/app/page.test.tsx`
- Modify: `src/app/auth/login/page.tsx`, `src/app/auth/login/page.test.tsx`
- Modify: `src/app/auth/signup/page.tsx`, `src/app/auth/signup/page.test.tsx`
- Modify: `src/app/auth/callback/route.ts`
- Modify: `src/app/auth/callback/legacy-next.test.ts`, `src/app/auth/callback/teacher-intent.test.ts`

**Interfaces:**
- Consumes: `api.get<CurrentIdentity>("/api/me")` and existing Supabase clients.
- Produces: `/auth/continue` and a single successful auth destination.

- [ ] **Step 1: Write failing entry and login tests**

Assert one root link, password login continuation, and OAuth/email confirmation destinations.

```tsx
expect(screen.getByRole("link", { name: "로그인하기" })).toHaveAttribute("href", "/auth/login");
expect(screen.queryByText("교사로 로그인")).not.toBeInTheDocument();
expect(router.push).toHaveBeenCalledWith("/auth/continue");
expect(signInWithOAuth).toHaveBeenCalledWith({
  provider: "google",
  options: { redirectTo: "http://localhost:3000/auth/callback?next=/auth/continue" },
});
```

- [ ] **Step 2: Write failing continuation tests**

Cover incomplete onboarding, student, teacher, admin, `AUTH_REQUIRED`, and transient retry.

```tsx
it.each([
  [{ onboarding_completed: false, capabilities: { teacher: false, admin: false } }, "/onboarding"],
  [{ onboarding_completed: true, capabilities: { teacher: false, admin: false } }, "/student"],
  [{ onboarding_completed: true, capabilities: { teacher: true, admin: false } }, "/teacher"],
  [{ onboarding_completed: true, capabilities: { teacher: true, admin: true } }, "/teacher"],
])("routes the current identity", async (identity, path) => {
  mockApi.get.mockResolvedValue(identity);
  render(<AuthContinuePage />);
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith(path));
});
```

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/app/page.test.tsx src/app/auth/login/page.test.tsx src/app/auth/signup/page.test.tsx src/app/auth/continue/page.test.tsx src/app/auth/callback/legacy-next.test.ts src/app/auth/callback/teacher-intent.test.ts
```

Expected: missing continuation route and old `/student`/teacher-intent behavior fail.

- [ ] **Step 4: Implement minimal unified flow**

```tsx
function destination(identity: CurrentIdentity): string {
  if (!identity.onboarding_completed) return "/onboarding";
  if (identity.capabilities.teacher || identity.capabilities.admin) return "/teacher";
  return "/student";
}
```

Use a guarded effect, loading state, retry alert, and `router.replace`. Make callback success allow only `/auth/continue`; exchange failure goes to `/auth/login?error=oauth_callback`.

- [ ] **Step 5: Verify GREEN and checkpoint**

Run Step 3 again, then `git diff --check`. Do not commit.

---

### Task 2: Membership-Only Staff Authorization

**Files:**
- Modify: `backend/identity/router.py`
- Modify: `tests/backend/test_staff_workflow.py`
- Modify: `tests/backend/test_admin_api.py`
- Modify: `tests/backend/test_student_management.py`

**Interfaces:**
- Consumes: `get_current_user`, `IdentityRepository.staff_role`, `StaffRole`.
- Produces: provider-independent `require_teacher` and `require_admin`.

- [ ] **Step 1: Write failing provider-independent guard tests**

```python
@pytest.mark.parametrize("provider", ["google", "password"])
async def test_teacher_membership_authorizes_any_provider(provider: str):
    actor = authenticated_user(provider=provider)
    repository.staff_role_value = StaffRole.TEACHER
    assert await require_teacher(actor, repository) == actor
```

Also preserve tests that initial-admin bootstrap rejects password, unverified, and mismatched accounts.

- [ ] **Step 2: Verify RED**

```bash
uv run pytest tests/backend/test_staff_workflow.py tests/backend/test_admin_api.py tests/backend/test_student_management.py -q
```

Expected: password member cases fail with the existing Google-only guard.

- [ ] **Step 3: Implement membership-only guards**

Use `CurrentUser` in both guards. Authorize teacher/admin solely from `staff_role`, but leave `StaffService.bootstrap_initial_admin` provider checks unchanged.

```python
if await repository.staff_role(user.user_id) not in {StaffRole.TEACHER, StaffRole.ADMIN}:
    raise ApiError("FORBIDDEN", "이 작업을 수행할 권한이 없습니다.", 403)
```

- [ ] **Step 4: Verify GREEN and checkpoint**

Run Step 2 again, then `git diff --check`. Do not commit.

---

### Task 3: Admin-Only Promotion API

**Files:**
- Modify: `backend/students/schemas.py`
- Modify: `backend/students/repository.py`
- Modify: `backend/students/service.py`
- Modify: `backend/students/router.py`
- Modify: `tests/backend/test_student_management.py`

**Interfaces:**
- Produces: `TeacherStudentView.staff_role: StaffRole | None`, `TeacherStudentPage.can_promote: bool`, and `POST /api/admin/students/{student_id}/promote-to-teacher`.

- [ ] **Step 1: Write failing list and promotion tests**

Cover role projection, admin success, existing-teacher idempotency, admin-target conflict, missing student, non-admin `403`, preserved student data, one audit transition, and concurrent promotion.

```python
response = await client.post(
    f"/api/admin/students/{student_id}/promote-to-teacher",
    headers=admin_headers,
)
assert response.status_code == 200
assert response.json()["staff_role"] == "teacher"
assert await membership_count(student_id) == 1
assert await audit_count("student.promoted_to_teacher", student_id) == 1
```

- [ ] **Step 2: Verify RED**

```bash
uv run pytest tests/backend/test_student_management.py -q
```

Expected: missing response fields and `404` for the new route.

- [ ] **Step 3: Project staff role and admin capability**

Left join memberships in all student-returning queries and map the extra column.

```sql
left join app.staff_memberships membership using (user_id)
select ..., student.include_in_statistics, membership.role::text
```

Set `can_promote` from the actor's current database role.

- [ ] **Step 4: Implement audited idempotent promotion**

Reject admin targets, return existing teachers, verify the student exists, then insert with conflict protection. Write audit only from the inserted CTE.

```sql
with inserted as (
  insert into app.staff_memberships (user_id, role, approved_by)
  values (%(target)s, 'teacher', %(actor)s)
  on conflict (user_id) do nothing
  returning user_id
), audited as (
  insert into app.audit_logs (actor_id, action, target_type, target_id, details)
  select %(actor)s, 'student.promoted_to_teacher', 'student_profile',
         %(target)s::text, jsonb_build_object('role', 'teacher')
  from inserted
)
select exists(select 1 from inserted)
```

Protect the route with `require_admin` and return a refreshed student view.

- [ ] **Step 5: Verify GREEN and checkpoint**

Run Step 2 again, then `git diff --check`. Do not commit.

---

### Task 4: Promotion UI

**Files:**
- Modify: `src/features/students/student-table.tsx`
- Modify: `src/features/students/student-cards.tsx`
- Modify: `src/features/students/student-editor.tsx`
- Modify: `src/features/students/student-editor.test.tsx`
- Modify: `src/app/teacher/students/page.tsx`
- Modify: `src/app/teacher/students/page.test.tsx`

**Interfaces:**
- Consumes: `staff_role`, `can_promote`, and Task 3 endpoint.
- Produces: admin-only confirmation, pending state, role badge, and local response update.

- [ ] **Step 1: Refresh installed shadcn guidance**

```bash
npx shadcn@latest info --json
npx shadcn@latest docs alert-dialog badge button spinner
```

Do not overwrite installed UI files.

- [ ] **Step 2: Write failing UI tests**

Cover hidden action for non-admin, visible action for admin/student, teacher/admin badge, confirmation, disabled pending action, exact API request, success state, and error alert.

```tsx
fireEvent.click(screen.getByRole("button", { name: "교사로 승격" }));
fireEvent.click(screen.getByRole("button", { name: "승격 확인" }));
await waitFor(() => expect(api.post).toHaveBeenCalledWith(
  `/api/admin/students/${student.user_id}/promote-to-teacher`,
  {},
));
```

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/features/students/student-editor.test.tsx src/app/teacher/students/page.test.tsx
```

- [ ] **Step 4: Implement role and promotion controls**

Extend `TeacherStudent` with `staff_role: "teacher" | "admin" | null`. Pass `canPromote`, `promoting`, and `onPromote` into the editor. Use `AlertDialog`, `Badge`, and `Spinner data-icon="inline-start"`. Replace the selected/list item with the endpoint response without closing the editor.

- [ ] **Step 5: Verify GREEN and checkpoint**

Run Step 3 again, then `git diff --check`. Do not commit.

---

### Task 5: Retire Teacher Entry Points

**Files:**
- Modify: `src/app/teacher/login/page.tsx`, `src/app/teacher/login/page.test.tsx`
- Modify: `src/app/teacher/apply/page.tsx`, `src/app/teacher/apply/page.test.tsx`
- Modify: `src/app/auth/teacher/start/route.ts`, `src/app/auth/teacher/start/route.test.ts`
- Modify: `src/app/teacher/layout.tsx`
- Modify: `src/components/layout/protected-staff-layout.tsx`
- Modify: frontend files/tests found by `rg -l 'teacher/login|teacher/apply' src`
- Modify: `src/components/navigation/teacher-navigation.tsx` and its tests.

**Interfaces:**
- Produces: legacy redirects to unified auth and no first-party application/login navigation.

- [ ] **Step 1: Write failing redirect/navigation tests**

Assert `/teacher/login -> /auth/login`, `/teacher/apply -> /auth/continue`, `/auth/teacher/start -> /auth/login`, `AUTH_REQUIRED -> /auth/login`, `FORBIDDEN -> /student`, and no teacher-application navigation item.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/app/teacher src/app/auth/teacher src/components/layout src/components/navigation src/app/admin
```

- [ ] **Step 3: Implement redirects and replace old destinations**

Use App Router `redirect()` for legacy pages and `NextResponse.redirect()` for the legacy route. Replace first-party authorization destinations and remove application navigation. Keep backend teacher-application endpoints registered.

- [ ] **Step 4: Verify GREEN and checkpoint**

Run Step 2 again. Then run `rg -n 'teacher/login|teacher/apply' src` and confirm remaining matches are compatibility routes/tests. Run `git diff --check`. Do not commit.

---

### Task 6: Full Verification and Live Flow

**Files:**
- Modify only when required by the new contract: relevant Playwright specs/fixtures.

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: verified unified routing and promotion behavior.

- [ ] **Step 1: Run complete automated verification**

```bash
npm test
npm run lint
npm run typecheck
npm run build
uv run pytest -q
npm run verify:vercel-python
```

Expected: every command exits `0` with no failures.

- [ ] **Step 2: Run relevant browser tests**

```bash
npm run test:e2e -- --grep "login|student|teacher|promotion"
```

- [ ] **Step 3: Verify the live local flow**

1. `/` shows one `로그인하기` action.
2. Existing admin Google login follows `/auth/continue -> /teacher`.
3. Student management promotes a non-staff student and updates its role badge.
4. The promoted account follows `/auth/continue -> /teacher` using its available auth method.
5. `/teacher/login` converges on `/auth/login` without starting OAuth.

- [ ] **Step 4: Final workspace review**

```bash
git status --short
git diff --check
git diff --stat
```

Confirm unrelated existing UI changes remain intact, `.env.local` is not exposed, and no commit or push exists.
