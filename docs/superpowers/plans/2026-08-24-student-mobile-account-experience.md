# Student Mobile Account Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every student route in one narrow mobile-style shell at every viewport size, add a role-aware four-or-five-item bottom navigation, and let students edit their own profile or log out from Home.

**Architecture:** The persistent student layout owns capability-based navigation and always renders a centered `46rem`-maximum canvas with a fixed bottom bar. Student Home keeps identity/statistics orchestration, while a focused account feature independently loads `GET /api/students/profile`, updates through the existing authenticated `PATCH`, and clears the Supabase browser session on confirmed logout. The FastAPI read path derives the target UUID only from `CurrentUser` and returns the existing `StudentProfileView`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 6, shadcn/ui/Radix, Supabase Auth, FastAPI, Pydantic, psycopg 3, PostgreSQL, Vitest/Testing Library, pytest, Playwright/browser verification.

**Spec:** `docs/superpowers/specs/2026-08-24-student-mobile-account-experience-design.md`

## Global Constraints

- Preserve teacher/admin login routing to `/teacher` and student login routing to `/student`.
- Keep one student UI implementation for phone, tablet, and desktop; desktop must not switch to a top navigation.
- Student-only accounts render four bottom-navigation items. Teacher/admin accounts render the same four plus `교사 모드` linking to `/teacher`.
- Keep profile editing and logout on student Home; do not create a fifth student-only profile tab or a dedicated profile route.
- Email, roles, user IDs, and `include_in_statistics` are never editable from this feature.
- All self-profile reads and writes derive the target from the authenticated bearer token.
- Keep FastAPI stateless and compatible with the existing Vercel Python function packaging.
- Preserve all unrelated dirty-worktree changes. Use tests first and observe the expected failure before production edits.
- Do not commit, push, merge, deploy, reset, stash, or clean. Use local diffs and `git diff --check` as checkpoints.

---

### Task 1: Make the Shared Phone Input Safely Controllable

**Files:**
- Modify: `src/components/forms/segmented-inputs.tsx`
- Modify: `src/app/onboarding/page.test.tsx`
- Create: `src/components/forms/segmented-inputs.test.tsx`

**Interfaces:**
- Preserve the current uncontrolled onboarding API.
- Add optional `value?: string` and `onChange?: (value: string) => void` props to `SegmentedPhoneInput`.
- Add `birthDateParts(value: string): BirthDateParts` for API-value prefill.
- Emit digits only from the controlled phone callback, capped at eleven digits.

- [ ] **Step 1: Write failing controlled-input tests**

Cover prefill, digit joining, focus advance, paste, backspace navigation, eleven-digit capping, and unchanged uncontrolled hidden-input behavior.

```tsx
function ControlledPhone() {
  const [value, setValue] = useState("01012345678");
  return (
    <SegmentedPhoneInput
      label="학생 연락처"
      name="phone"
      value={value}
      onChange={setValue}
    />
  );
}

render(<ControlledPhone />);
expect(screen.getByLabelText("학생 연락처 앞자리")).toHaveValue("010");
expect(screen.getByLabelText("학생 연락처 중간자리")).toHaveValue("1234");
expect(screen.getByLabelText("학생 연락처 끝자리")).toHaveValue("5678");
```

Also assert:

```ts
expect(birthDateParts("2012-04-03")).toEqual({ year: "2012", month: "04", day: "03" });
expect(birthDateParts("")).toEqual({ year: "", month: "", day: "" });
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/forms/segmented-inputs.test.tsx src/app/onboarding/page.test.tsx
```

Expected: the new props/helper do not exist and prefill assertions fail; existing onboarding tests remain green.

- [ ] **Step 3: Implement a single controlled/uncontrolled state path**

Keep segments as `[3, 4, 4]`, split an incoming value with fixed boundaries, and allow the final segment to hold three or four digits so existing ten-digit data remains editable.

```tsx
type SegmentedPhoneInputProps = {
  label: string;
  name: string;
  value?: string;
  onChange?: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoComplete?: string;
};

function phoneParts(value: string): PhoneParts {
  const digits = digitsOnly(value).slice(0, 11);
  return [digits.slice(0, 3), digits.slice(3, 7), digits.slice(7, 11)];
}
```

Use the external value when it is defined; otherwise retain internal state. Route every edit and paste through one `commit(nextParts)` function that updates internal state when uncontrolled and calls `onChange?.(nextParts.join(""))` in either mode. Keep the hidden input as the normalized joined value.

```tsx
const controlled = value !== undefined;
const parts = controlled ? phoneParts(value) : internalParts;

function commit(next: PhoneParts) {
  if (!controlled) setInternalParts(next);
  onChange?.(next.join(""));
}
```

- [ ] **Step 4: Verify GREEN and checkpoint**

Run Step 2 again, then:

```bash
npm run typecheck
git diff --check
```

Do not commit.

---

### Task 2: Add the Authenticated Self-Profile Read API

**Files:**
- Modify: `backend/identity/repository.py`
- Modify: `backend/identity/service.py`
- Modify: `backend/identity/router.py`
- Modify: `tests/backend/test_identity_api.py`
- Modify: `tests/backend/test_identity_service.py`
- Modify: `tests/backend/test_auth.py`

**Interfaces:**
- Produce: authenticated `GET /api/students/profile -> StudentProfileView`.
- Add: `IdentityRepository.student_profile(user_id: UUID) -> StudentProfileRecord | None`.
- Add: `IdentityService.current_student_profile(user: AuthenticatedUser) -> StudentProfileView`.
- Missing profile: `ApiError("PROFILE_REQUIRED", "학생 정보를 먼저 등록해 주세요.", 403)`.

- [ ] **Step 1: Write failing API tests**

Extend `FakeIdentityService` with a recorded `current_student_profile` call and a profile fixture. Assert that the endpoint passes only the dependency-injected authenticated user and returns the existing schema.

```python
async def test_profile_get_uses_the_authenticated_user(
    client: httpx.AsyncClient,
    identity_api: FakeIdentityService,
    api_user: AuthenticatedUser,
) -> None:
    response = await client.get("/api/students/profile")

    assert response.status_code == 200
    assert identity_api.profile_reads == [api_user]
    assert response.json() == {
        "name": "김민준",
        "birth_date": "2012-04-03",
        "phone": "01012345678",
        "guardian_phone": "01098765432",
        "include_in_statistics": True,
    }
```

Add a focused case to `tests/backend/test_auth.py` that requests the new endpoint without an Authorization header and asserts the existing auth layer returns `401`/`AUTH_REQUIRED`.

- [ ] **Step 2: Write failing service/repository contract tests**

Add `student_profile_value` and a `student_profile(user_id)` call log to `RecordingStudentRepository`. Cover successful mapping and missing-profile behavior.

```python
profile = await service.current_student_profile(verified_student)
assert repository.profile_reads == [verified_student.user_id]
assert profile.include_in_statistics is True

repository.student_profile_value = None
with pytest.raises(ApiError) as error:
    await service.current_student_profile(verified_student)
assert (error.value.code, error.value.status_code) == ("PROFILE_REQUIRED", 403)
```

- [ ] **Step 3: Verify RED**

```bash
uv run pytest tests/backend/test_identity_api.py tests/backend/test_identity_service.py tests/backend/test_auth.py -q
```

Expected: `GET` is `405`/missing and repository/service methods are absent.

- [ ] **Step 4: Implement the caller-scoped repository query**

```python
async def student_profile(self, user_id: UUID) -> StudentProfileRecord | None:
    cursor = await self._connection.execute(
        """
        select profile.user_id, profile.email, profile.name,
               student.birth_date, profile.phone,
               student.guardian_phone, student.include_in_statistics
        from app.user_profiles profile
        join app.student_profiles student using (user_id)
        where profile.user_id = %s
        """,
        (user_id,),
    )
    row = await cursor.fetchone()
    return StudentProfileRecord(*row) if row is not None else None
```

The SQL must not accept an arbitrary target from query parameters or request JSON.

- [ ] **Step 5: Implement service mapping and route**

```python
async def current_student_profile(
    self, user: AuthenticatedUser
) -> StudentProfileView:
    profile = await self._repository.student_profile(user.user_id)
    if profile is None:
        raise ApiError("PROFILE_REQUIRED", "학생 정보를 먼저 등록해 주세요.", 403)
    return StudentProfileView(
        name=profile.name,
        birth_date=profile.birth_date,
        phone=profile.phone,
        guardian_phone=profile.guardian_phone,
        include_in_statistics=profile.include_in_statistics,
    )
```

```python
@router.get("/students/profile", response_model=StudentProfileView)
async def current_student_profile(
    user: CurrentUser,
    service: IdentityServiceDependency,
) -> StudentProfileView:
    return await service.current_student_profile(user)
```

Place `GET` beside the existing `POST` and `PATCH`; do not change update authorization or schema fields.

- [ ] **Step 6: Verify GREEN and checkpoint**

```bash
uv run pytest tests/backend/test_identity_api.py tests/backend/test_identity_service.py tests/backend/test_auth.py -q
uv run ruff check backend/identity tests/backend/test_identity_api.py tests/backend/test_identity_service.py tests/backend/test_auth.py
git diff --check
```

Do not commit.

---

### Task 3: Render Four Student Tabs or Five Tabs with `교사 모드`

**Files:**
- Modify: `src/components/navigation/student-navigation.tsx`
- Modify: `src/app/student/layout.test.tsx`

**Interfaces:**
- Consume: `api.get<CurrentIdentity>("/api/me", { signal })`.
- Render four base links for every account.
- Append `{ href: "/teacher", label: "교사 모드" }` only when `teacher || admin`.
- Capability lookup failures and aborts silently retain the four-link fallback.

- [ ] **Step 1: Write failing navigation tests**

Mock `api.get` in `src/app/student/layout.test.tsx`. Cover student, teacher, admin, failure fallback, active student route, and unmount cancellation.

```tsx
mockApi.get.mockResolvedValue({
  capabilities: { student: true, teacher: true, admin: false },
});
render(<StudentLayout><p>학생 내용</p></StudentLayout>);

const nav = screen.getByRole("navigation", { name: "학생 메뉴" });
expect(await within(nav).findByRole("link", { name: "교사 모드" })).toHaveAttribute(
  "href",
  "/teacher",
);
expect(within(nav).getAllByRole("link")).toHaveLength(5);
expect(nav).toHaveAttribute("data-items", "5");
```

For a student-only identity or rejected request, assert exactly the existing four destinations and no `교사 모드`.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/app/student/layout.test.tsx
```

Expected: the role-aware fifth link and `data-items` state are missing.

- [ ] **Step 3: Implement a guarded capability lookup**

Use `useEffect`, `AbortController`, and an `active` flag. Do not show a blocking spinner and do not redirect from navigation.

```tsx
type CurrentIdentity = {
  capabilities: { teacher: boolean; admin: boolean };
};

const [staffMode, setStaffMode] = useState(false);

useEffect(() => {
  const controller = new AbortController();
  let active = true;
  api.get<CurrentIdentity>("/api/me", { signal: controller.signal })
    .then((identity) => {
      if (active) setStaffMode(identity.capabilities.teacher || identity.capabilities.admin);
    })
    .catch(() => undefined);
  return () => {
    active = false;
    controller.abort();
  };
}, []);
```

Build `links` from the four immutable base links and append a Lucide-icon `교사 모드` entry. Set `data-items={links.length}` on the semantic `<nav>`.

- [ ] **Step 4: Verify GREEN and checkpoint**

```bash
npm test -- src/app/student/layout.test.tsx
npm run typecheck
git diff --check
```

Do not commit.

---

### Task 4: Keep the Narrow Bottom-Navigation Shell at Every Breakpoint

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/student/layout.test.tsx`
- Verify: `src/components/layout/student-shell.tsx`

**Interfaces:**
- `.student-shell`: centered, `width: min(100%, 46rem)`, full viewport minimum height.
- `.student-navigation`: fixed bottom, centered, same maximum width as the shell, safe-area aware.
- `data-items="4"` and `data-items="5"`: equal-width tab grids.
- No `@media (min-width: 64rem)` rule may move student navigation to the top or remove bottom content padding.

- [ ] **Step 1: Add failing shell-style assertions**

Keep the existing real scan-root assertion, then replace the old desktop-top-navigation expectation with the approved invariants.

```ts
const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
expect(css).toMatch(/\.student-shell\s*\{[^}]*width:\s*min\(100%,\s*46rem\)/s);
expect(css).toMatch(/\.student-navigation\s*\{[^}]*bottom:\s*0[^}]*width:\s*min\(100%,\s*46rem\)/s);
expect(css).toMatch(/\.student-navigation\[data-items="5"\]\s+ul\s*\{[^}]*repeat\(5/s);

const desktopRules = css.slice(css.indexOf("@media (min-width: 64rem)"));
expect(desktopRules).not.toMatch(/\.student-navigation\s*\{[^}]*(top:\s*0|bottom:\s*auto)/s);
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/app/student/layout.test.tsx
```

Expected: the shell/navigation width and five-column rules are missing, while desktop still moves the bar to the top.

- [ ] **Step 3: Implement the all-breakpoint mobile canvas**

```css
.student-shell {
  width: min(100%, 46rem);
  min-width: 0;
  min-height: 100dvh;
  margin-inline: auto;
}

.student-shell-content {
  min-width: 0;
  padding-bottom: calc(4rem + env(safe-area-inset-bottom));
}

.student-navigation {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  width: min(100%, 46rem);
  margin-inline: auto;
}

.student-navigation[data-items="4"] ul {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.student-navigation[data-items="5"] ul {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
```

Retain all existing borders, backdrop blur, focus styles, safe-area padding, and scan full-bleed exception. Remove only the student-specific desktop rules that set `padding-top`, clear `padding-bottom`, set `top: 0`, use row tabs, or add the desktop active underline. Keep unrelated attendance/events desktop responsiveness.

- [ ] **Step 4: Verify GREEN and checkpoint**

```bash
npm test -- src/app/student/layout.test.tsx
npm run lint
git diff --check
```

Do not commit.

---

### Task 5: Build the Prefilled Student Profile Form

**Files:**
- Create: `src/features/student-account/types.ts`
- Create: `src/features/student-account/student-profile-form.tsx`
- Create: `src/features/student-account/student-profile-form.test.tsx`
- Reuse: `src/components/forms/segmented-inputs.tsx`
- Reuse: `src/components/ui/field.tsx`
- Reuse: `src/components/ui/alert.tsx`

**Interfaces:**

```ts
export type StudentProfile = {
  name: string;
  birth_date: string;
  phone: string;
  guardian_phone: string;
  include_in_statistics: boolean;
};

export type EditableStudentProfile = Pick<
  StudentProfile,
  "name" | "birth_date" | "phone" | "guardian_phone"
>;

type StudentProfileFormProps = {
  email: string;
  profile: StudentProfile;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onSubmit: (profile: EditableStudentProfile) => void | Promise<void>;
};
```

- [ ] **Step 1: Write failing form tests**

Assert API values prefill all segments, email is read-only and unnamed, only four editable fields are submitted, whitespace is trimmed, phones contain digits only, and pending/error states preserve typed values.

```tsx
render(
  <StudentProfileForm
    email="student@example.com"
    profile={profile}
    pending={false}
    onCancel={onCancel}
    onSubmit={onSubmit}
  />,
);

expect(screen.getByLabelText("이메일")).toHaveValue("student@example.com");
expect(screen.getByLabelText("이메일")).toHaveAttribute("readonly");
expect(screen.getByLabelText("이름")).toHaveValue("김민준");
expect(screen.getByLabelText("생년")).toHaveValue("2012");

fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);
expect(onSubmit).toHaveBeenCalledWith({
  name: "김민준",
  birth_date: "2012-04-03",
  phone: "01012345678",
  guardian_phone: "01098765432",
});
```

Assert no form control or payload path exists for `include_in_statistics`, role, user ID, or email.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/features/student-account/student-profile-form.test.tsx
```

Expected: the feature files do not exist.

- [ ] **Step 3: Implement controlled form state**

Initialize name, date segments, and phone values from `profile` when the dialog/form mounts. Use Task 1 helpers/components, the existing shadcn `Field` primitives, and the same Korean validation language as onboarding.

```tsx
const [name, setName] = useState(profile.name);
const [birthDate, setBirthDate] = useState(() => birthDateParts(profile.birth_date));
const [phone, setPhone] = useState(profile.phone);
const [guardianPhone, setGuardianPhone] = useState(profile.guardian_phone);

function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (pending) return;
  onSubmit({
    name: name.trim(),
    birth_date: birthDateValue(birthDate),
    phone,
    guardian_phone: guardianPhone,
  });
}
```

Use a visible read-only email input, `SegmentedBirthDateInput`, two controlled `SegmentedPhoneInput` instances, a cancel button, and a submit button with `Spinner` while pending. Leave the form mounted on errors so edits are not discarded.

- [ ] **Step 4: Verify GREEN and checkpoint**

```bash
npm test -- src/features/student-account/student-profile-form.test.tsx src/components/forms/segmented-inputs.test.tsx
npm run typecheck
git diff --check
```

Do not commit.

---

### Task 6: Build the Independent Account Card, Edit Dialog, and Logout Confirmation

**Files:**
- Create: `src/features/student-account/student-account-card.tsx`
- Create: `src/features/student-account/student-account-card.test.tsx`
- Reuse: `src/features/student-account/student-profile-form.tsx`
- Reuse: `src/components/ui/card.tsx`
- Reuse: `src/components/ui/dialog.tsx`
- Reuse: `src/components/ui/alert-dialog.tsx`
- Reuse: `src/lib/api/client.ts`
- Reuse: `src/lib/supabase/client.ts`

**Interfaces:**
- `StudentAccountCard({ email }: { email: string })`.
- Load: `api.get<StudentProfile>("/api/students/profile", { signal })`.
- Save: `api.patch<StudentProfile>("/api/students/profile", EditableStudentProfile)`.
- Logout: `createBrowserSupabaseClient().auth.signOut()` then `router.replace("/auth/login")` only when `error` is null.

- [ ] **Step 1: Write failing load and edit tests**

Mock API, router, and Supabase client. Cover independent loading, success card, temporary-load retry, auth/profile redirects, dialog prefill, exact PATCH body, duplicate-submit prevention, server error preservation, and successful local card refresh.

```tsx
mockApi.get.mockResolvedValue(profile);
render(<StudentAccountCard email="student@example.com" />);

expect(await screen.findByRole("heading", { name: "내 정보" })).toBeInTheDocument();
fireEvent.click(screen.getByRole("button", { name: "개인정보 수정" }));
expect(screen.getByRole("dialog")).toBeInTheDocument();

fireEvent.click(screen.getByRole("button", { name: "저장" }));
await waitFor(() => expect(mockApi.patch).toHaveBeenCalledWith(
  "/api/students/profile",
  expect.objectContaining({
    name: "김민준",
    birth_date: "2012-04-03",
    phone: "01012345678",
    guardian_phone: "01098765432",
  }),
));
```

Assert the PATCH body contains neither `email` nor `include_in_statistics`.

- [ ] **Step 2: Write failing logout tests**

Cover confirmation required, pending controls disabled, success replacement, failure message, no redirect on failure, and no duplicate `signOut` call.

```tsx
fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
expect(signOut).not.toHaveBeenCalled();
fireEvent.click(screen.getByRole("button", { name: "로그아웃 확인" }));
await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
expect(router.replace).toHaveBeenCalledWith("/auth/login");
```

- [ ] **Step 3: Verify RED**

```bash
npm test -- src/features/student-account/student-account-card.test.tsx
```

Expected: the account-card feature does not exist.

- [ ] **Step 4: Implement independent profile loading and route-aware errors**

Keep account state local so statistics/event failures do not erase it. Abort the load on unmount.

```ts
function handleProfileError(error: unknown): boolean {
  if (error instanceof ApiClientError && error.code === "AUTH_REQUIRED") {
    router.replace("/auth/login");
    return true;
  }
  if (error instanceof ApiClientError && error.code === "PROFILE_REQUIRED") {
    router.replace("/onboarding");
    return true;
  }
  return false;
}
```

Render a shadcn Card with an actual `<h2>` containing `내 정보`, the read-only email summary, and the two approved actions. Loading/error/retry UI remains inside this card only.

- [ ] **Step 5: Implement controlled edit dialog and PATCH state**

Open a `Dialog` containing `StudentProfileForm`. Disable dialog actions during save. On success, replace the local profile with the typed response and close the dialog. On failure, keep it open and show the server message.

```tsx
const saved = await api.patch<StudentProfile>(
  "/api/students/profile",
  editableProfile,
);
setProfile(saved);
setEditOpen(false);
```

- [ ] **Step 6: Implement confirmed Supabase logout**

Use `AlertDialog` with `로그아웃 취소` and `로그아웃 확인`. Call `signOut` exactly once while pending.

```ts
const { error } = await createBrowserSupabaseClient().auth.signOut();
if (error) {
  setLogoutError("로그아웃하지 못했습니다. 다시 시도해 주세요.");
  return;
}
router.replace("/auth/login");
```

Do not redirect, close optimistically, or claim success if Supabase returns an error.

- [ ] **Step 7: Verify GREEN and checkpoint**

```bash
npm test -- src/features/student-account/student-account-card.test.tsx src/features/student-account/student-profile-form.test.tsx
npm run typecheck
npm run lint
git diff --check
```

Do not commit.

---

### Task 7: Integrate the Account Card into Home and Remove the Header Mode Button

**Files:**
- Modify: `src/app/student/page.tsx`
- Modify: `src/app/student/page.test.tsx`
- Modify: `src/app/globals.css`
- Reuse: `src/features/student-account/student-account-card.tsx`

**Interfaces:**
- Extend the local `Me` type with `email: string`.
- Preserve the existing identity/statistics precedence and redirect behavior.
- Store the fulfilled identity and render `<StudentAccountCard email={identity.email} />` after weekly events.
- Remove `canViewTeacher`, `LayoutDashboardIcon`, and the Home-header teacher link entirely.

- [ ] **Step 1: Write failing Home integration tests**

Mock `StudentAccountCard` so page orchestration tests do not absorb the feature's own API request. Add `email` and complete capability fields to all identity fixtures.

```tsx
vi.mock("@/features/student-account/student-account-card", () => ({
  StudentAccountCard: ({ email }: { email: string }) => (
    <section aria-label="내 정보 테스트">{email}</section>
  ),
}));
```

Assert:

```tsx
expect(await screen.findByLabelText("내 정보 테스트")).toHaveTextContent("student@example.com");
expect(screen.queryByRole("link", { name: "교사 화면 보기" })).not.toBeInTheDocument();
expect(events.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
```

Replace the existing test that expects a staff Home-header link with one proving staff identity still has no header action; Task 3 owns the only `교사 모드` link.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/app/student/page.test.tsx
```

Expected: identity email is not stored, the account card is missing, and the staff header action still renders.

- [ ] **Step 3: Refactor Home identity state without changing precedence**

```tsx
type Me = {
  email: string;
  onboarding_completed: boolean;
  capabilities: { student: boolean; teacher: boolean; admin: boolean };
};

const [identity, setIdentity] = useState<Me>();
```

Reset `identity` on retry, assign it only after the existing auth/onboarding/failure precedence has resolved, and keep the loading state until both identity and statistics exist. Do not change event loading behavior.

- [ ] **Step 4: Simplify the header and append account content**

Keep only `BrandLockup` in the header's top row. Render the account card after `EventOccurrences` and add narrowly scoped `.student-account-*` styling only where the feature component needs it.

```tsx
<section className="student-home-events" aria-labelledby="student-home-events-heading">
  {/* existing weekly events */}
</section>
<StudentAccountCard email={identity.email} />
```

- [ ] **Step 5: Verify GREEN and checkpoint**

```bash
npm test -- src/app/student/page.test.tsx src/features/student-account/student-account-card.test.tsx
npm run typecheck
npm run lint
git diff --check
```

Do not commit.

---

### Task 8: Full Regression, Responsive Browser, and Vercel Compatibility Verification

**Files:**
- Verify only: all modified files
- Update only if an assertion exposes a real scoped defect: relevant test or feature file from Tasks 1-7

**Interfaces:**
- Student-only: four bottom tabs and no `교사 모드`.
- Teacher/admin in student routes: five bottom tabs including `교사 모드`.
- All supported widths: same centered narrow canvas and fixed bottom tabs.
- Home: independent account loading, editable four-field profile, read-only email, confirmed logout.
- Backend/Vercel: stateless authenticated GET/PATCH behavior and unchanged Python builder compatibility.

- [ ] **Step 1: Run focused frontend and backend suites**

```bash
npm test -- src/components/forms/segmented-inputs.test.tsx src/app/onboarding/page.test.tsx src/app/student/layout.test.tsx src/features/student-account/student-profile-form.test.tsx src/features/student-account/student-account-card.test.tsx src/app/student/page.test.tsx
uv run pytest tests/backend/test_identity_api.py tests/backend/test_identity_service.py tests/backend/test_auth.py -q
```

Expected: all focused tests pass.

- [ ] **Step 2: Run complete automated verification**

```bash
npm test
npm run typecheck
npm run lint
uv run pytest -q
uv run ruff check .
npm run build
npm run verify:vercel-python
git diff --check
```

Record exact pass/fail counts. Fix only failures caused by this plan; preserve unrelated dirty changes.

- [ ] **Step 3: Verify the live API contract locally**

With the existing Next.js server on `http://localhost:3000` and FastAPI on `http://127.0.0.1:8000`, use an authenticated browser session to verify:

1. `GET /api/students/profile` returns only the signed-in account's `StudentProfileView`.
2. Editing name/date/phones persists after a page reload.
3. Email and statistics inclusion are not present in the PATCH request body.
4. A missing/expired session returns to `/auth/login`.

Do not mutate another student's profile or statistics-inclusion setting.

- [ ] **Step 4: Perform responsive browser verification**

Use the browser-control skill or Playwright at these viewport classes:

- Phone: `390 x 844`
- Tablet: `768 x 1024`
- Desktop: `1440 x 900`

At each width verify that the content remains centered and no wider than `46rem`, the navigation remains at the bottom, content is not hidden behind it, dialogs fit without horizontal overflow, and QR scan remains usable. Capture screenshots for evidence.

Test one student identity and one teacher/admin identity. Confirm four versus five tabs, `교사 모드 -> /teacher`, and no Home-header teacher button.

- [ ] **Step 5: Verify account failure paths interactively**

Confirm edit cancellation keeps server data unchanged, server errors keep typed values visible, logout requires confirmation, failed logout does not navigate, and successful logout lands on `/auth/login` without reopening Home through Back.

- [ ] **Step 6: Apply the verification-before-completion gate**

Use `superpowers:verification-before-completion`. Review the final diff against every acceptance criterion in the spec, then run:

```bash
git status --short
git diff --stat
git diff --check
rg -n "교사 화면 보기|top:\s*0|bottom:\s*auto" src/app/student src/components/navigation/student-navigation.tsx src/app/globals.css
```

The first grep term must be absent from the student Home implementation; any `top: 0` or `bottom: auto` match must be inspected to prove it is unrelated to `.student-navigation`.

- [ ] **Step 7: Report the local handoff**

Report automated counts, three viewport results, API/profile/logout evidence, remaining external verification gates, and the exact dirty paths. Explicitly state that no commit, push, merge, deploy, reset, stash, or clean occurred.
