# Church Attendance Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the Vercel-compatible Next.js/FastAPI/Supabase foundation and deliver student onboarding plus administrator-approved teacher access.

**Architecture:** Next.js owns responsive pages and Supabase Auth cookies; every application-data request goes to FastAPI under `/api`. FastAPI validates Supabase JWTs, reads roles from a private PostgreSQL schema, and keeps authorization out of browser-editable metadata.

**Tech Stack:** Next.js 16.3.1, React 19.2.8, TypeScript 7.0.2, Tailwind CSS 4.3.3, Supabase JS 2.112.3, Supabase SSR 0.12.4, Python 3.12, FastAPI 0.141.1, Pydantic Settings 2.15.0, PyJWT 2.13.0, psycopg 3.3.4, Vitest 4.1.11, pytest 9.1.1, Playwright 1.62.1

**Spec:** `docs/superpowers/specs/2026-08-21-church-attendance-system-design.md`

## Global Constraints

- Keep one responsive frontend codebase for mobile, tablet, and desktop.
- Export the FastAPI `app` from `api/index.py`; reserve all `/api/*` routes for FastAPI.
- Use Python 3.12 and pin all JavaScript and Python dependencies with committed lockfiles.
- Store durable state only in Supabase PostgreSQL; Vercel function memory is never authoritative.
- Target the Vercel Hobby technical envelope: one Python FastAPI Function, explicit Fluid Compute, conservative 500 MB bundle, 2 GB/1 vCPU standard instance, and ordinary API requests well under 10 seconds.
- Use a production Supabase/Supavisor transaction-pooler URL with bounded connect/query timeouts and explicit connection cleanup; never run migrations during a Function request.
- The browser may use the Supabase publishable key for Auth but must not access application tables directly.
- Store application authorization in PostgreSQL, never in `user_metadata`.
- Students self-register; teachers authenticate with Google and require administrator approval.
- Require email confirmation for email/password students.
- Use `Asia/Seoul` for business dates and display.
- Commit only safe examples; never commit a real URL, key, hash, token, or password.
- Implement each behavior test-first and commit after every task passes its focused verification.
- Treat Hobby plan eligibility as a deployment gate because its free usage is restricted by current personal/non-commercial fair-use terms; technical compatibility does not guarantee organizational production eligibility.

## File Structure

### Shared project and Vercel entrypoint

- `package.json`: frontend, CLI, and test commands with exact dependency pins.
- `package-lock.json`: npm dependency lock.
- `pyproject.toml`: Python runtime, application dependencies, pytest, and Ruff configuration.
- `uv.lock`: Python dependency lock.
- `api/index.py`: Vercel-recognized FastAPI entrypoint that re-exports `backend.main.app`.
- `vercel.json`: Python bundle exclusions and framework-neutral Vercel settings.
- `.env.example`: documented safe environment-variable names.

### Next.js identity UI

- `src/app/layout.tsx`: root HTML, metadata, and global styles.
- `src/app/page.tsx`: root teacher/student role choice.
- `src/app/auth/login/page.tsx`: student Google and email login.
- `src/app/auth/signup/page.tsx`: student email/password signup.
- `src/app/auth/callback/route.ts`: PKCE code exchange and safe post-auth redirect.
- `src/app/onboarding/page.tsx`: student profile completion.
- `src/app/teacher/login/page.tsx`: Google-only teacher entry.
- `src/app/teacher/apply/page.tsx`: teacher application and status.
- `src/app/teacher/applications/page.tsx`: administrator-only teacher application queue.
- `src/app/admin/staff/page.tsx`: staff promotion and demotion.
- `src/lib/supabase/client.ts`: browser Supabase client.
- `src/lib/supabase/server.ts`: cookie-aware server Supabase client.
- `src/lib/supabase/proxy.ts`: request/response cookie refresh helper.
- `src/lib/api/client.ts`: typed bearer-token FastAPI client.
- `src/lib/auth/redirect.ts`: allowed internal redirect validation.
- `proxy.ts`: refresh Supabase SSR cookies on protected page requests.

### FastAPI identity domain

- `backend/main.py`: app factory, CORS, shared exception handlers, and routers.
- `backend/core/config.py`: typed environment configuration.
- `backend/core/db.py`: async psycopg connection helper.
- `backend/core/errors.py`: stable API error envelope and domain exceptions.
- `backend/core/auth.py`: Supabase JWKS validation and authenticated-user dependency.
- `backend/identity/models.py`: identity-domain value objects and enums.
- `backend/identity/schemas.py`: API request and response models.
- `backend/identity/repository.py`: profile, application, and staff SQL.
- `backend/identity/service.py`: onboarding, teacher decisions, and last-admin rules.
- `backend/identity/router.py`: `/api/me`, profile, teacher-application, and admin endpoints.

### Tests

- `tests/backend/test_health.py`: Vercel entrypoint and health response.
- `tests/backend/test_auth.py`: JWT and provider verification.
- `tests/backend/test_identity_service.py`: onboarding and staff business rules.
- `tests/backend/test_identity_api.py`: API authorization and response contracts.
- `tests/backend/conftest.py`: async client, isolated database transaction, RSA/JWKS token factory, and identity fixtures.
- `src/test/mock-api.ts`: typed API test double used by page and feature tests.
- `src/app/page.test.tsx`: root role choices.
- `src/app/onboarding/page.test.tsx`: onboarding validation and submission.
- `src/app/teacher/apply/page.test.tsx`: application states.
- `tests/e2e/identity.spec.ts`: browser identity navigation and guarded routes.

---

### Task 1: Polyglot Vercel Skeleton

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `next.config.ts`
- Create: `postcss.config.mjs`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`
- Create: `vitest.setup.ts`
- Create: `pyproject.toml`
- Create: `uv.lock`
- Create: `api/index.py`
- Create: `backend/main.py`
- Create: `backend/core/config.py`
- Create: `vercel.json`
- Create: `.env.example`
- Create: `src/app/layout.tsx`
- Create: `src/app/globals.css`
- Create: `src/app/page.tsx`
- Create: `tests/backend/conftest.py`
- Create: `src/test/mock-api.ts`
- Test: `tests/backend/test_health.py`
- Test: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: approved spec only.
- Produces: `backend.main.app: FastAPI`, `GET /api/health -> {"status":"ok"}`, a root page with links to `/teacher/login` and `/auth/login`, `token_factory(provider, verified, subject) -> str`, and typed `mockApi` spies.

- [ ] **Step 1: Create pinned project manifests and test configuration**

Create `package.json` with these scripts and exact direct dependencies:

```json
{
  "private": true,
  "engines": { "node": "22.x" },
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "vercel:dev": "vercel dev",
    "supabase:start": "supabase start",
    "supabase:reset": "supabase db reset"
  },
  "dependencies": {
    "@hookform/resolvers": "5.9.1",
    "@supabase/ssr": "0.12.4",
    "@supabase/supabase-js": "2.112.3",
    "date-fns": "4.4.0",
    "lucide-react": "1.33.0",
    "next": "16.3.1",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "react-hook-form": "7.85.0",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@playwright/test": "1.62.1",
    "@tailwindcss/postcss": "4.3.3",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.2",
    "@types/node": "22.18.1",
    "@types/react": "19.2.18",
    "@types/react-dom": "19.2.4",
    "eslint": "10.8.1",
    "eslint-config-next": "16.3.1",
    "jsdom": "30.0.1",
    "supabase": "2.115.0",
    "tailwindcss": "4.3.3",
    "typescript": "7.0.2",
    "vercel": "59.3.0",
    "vitest": "4.1.11"
  }
}
```

Create `pyproject.toml` with Python `>=3.12,<3.13`, application pins `fastapi==0.141.1`, `pydantic-settings==2.15.0`, `PyJWT[crypto]==2.13.0`, `psycopg[binary,pool]==3.3.4`, `httpx==0.28.1`, and `email-validator==2.3.0`; add development pins `pytest==9.1.1`, `pytest-asyncio==1.4.0`, and `ruff==0.16.4`. Configure pytest with `asyncio_mode = "auto"` and Ruff target `py312`.

Run:

```bash
npm install
uv python install 3.12
uv sync
```

Expected: `package-lock.json` and `uv.lock` are created without dependency-resolution errors.

- [ ] **Step 2: Write failing frontend and backend smoke tests**

```tsx
// src/app/page.test.tsx
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

it("offers student and teacher entry points", () => {
  render(<HomePage />);
  expect(screen.getByRole("link", { name: "학생으로 로그인" })).toHaveAttribute("href", "/auth/login");
  expect(screen.getByRole("link", { name: "교사로 로그인" })).toHaveAttribute("href", "/teacher/login");
});
```

```python
# tests/backend/test_health.py
from fastapi.testclient import TestClient
from api.index import app

def test_health_endpoint() -> None:
    response = TestClient(app).get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 3: Run smoke tests and verify failure**

Run:

```bash
npm test -- src/app/page.test.tsx
uv run pytest tests/backend/test_health.py -v
```

Expected: frontend fails because `src/app/page.tsx` is absent, and backend fails because `api.index` is absent.

- [ ] **Step 4: Implement the minimal Vercel entrypoint and root UI**

```python
# backend/main.py
from fastapi import FastAPI

app = FastAPI(title="Church Attendance API")

@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

```python
# api/index.py
from backend.main import app

__all__ = ["app"]
```

```tsx
// src/app/page.tsx
import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>교회 출결</h1>
      <Link href="/teacher/login">교사로 로그인</Link>
      <Link href="/auth/login">학생으로 로그인</Link>
    </main>
  );
}
```

Create the listed Next.js, Tailwind, ESLint, Vitest, Vercel, config, layout, CSS, and safe environment-example files. `vercel.json` must exclude `tests/**`, `.superpowers/**`, and local fixtures from `api/**/*.py` bundles. `.env.example` must list only variable names from spec section 13.

Create `tests/backend/conftest.py` with an async HTTPX ASGI client, per-test database rollback fixture, RSA keypair/JWKS fixture, and `token_factory(provider: str, verified: bool, subject: UUID) -> str`. Create `src/test/mock-api.ts` exporting `mockApi = { get, post, patch, delete }` as resettable Vitest spies and reset it from `vitest.setup.ts` after each test.

- [ ] **Step 5: Verify the skeleton**

Run:

```bash
npm test -- src/app/page.test.tsx
uv run pytest tests/backend/test_health.py -v
npm run typecheck
uv run ruff check backend api tests/backend
```

Expected: all commands pass.

- [ ] **Step 6: Commit the skeleton**

```bash
git add package.json package-lock.json pyproject.toml uv.lock api backend src tests tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.ts vitest.setup.ts vercel.json .env.example
git commit -m "build: scaffold Vercel Next and FastAPI app"
```

### Task 2: Identity Database Schema

**Files:**
- Create via CLI: `supabase/config.toml`
- Create via CLI: generated `supabase/migrations/*_identity_core.sql`
- Test: `tests/backend/test_identity_schema.py`

**Interfaces:**
- Consumes: `DATABASE_URL` from Task 1.
- Produces: private `app` schema, `teacher_application_status`, `staff_role`, `user_profiles`, `student_profiles`, `teacher_applications`, `staff_memberships`, and `audit_logs`.

- [ ] **Step 1: Initialize Supabase and create the migration through the CLI**

Run:

```bash
npx supabase init
npx supabase migration new identity_core
```

Expected: Supabase prints one new migration path ending in `_identity_core.sql`. Record that exact generated path and use it for every remaining step in this task; do not rename it or invent a timestamp.

- [ ] **Step 2: Write the failing schema integration test**

```python
# tests/backend/test_identity_schema.py
import os
import psycopg

def test_identity_tables_exist() -> None:
    with psycopg.connect(os.environ["TEST_DATABASE_URL"]) as connection:
        names = connection.execute(
            "select table_name from information_schema.tables where table_schema = 'app'"
        ).fetchall()
    assert {row[0] for row in names} >= {
        "user_profiles", "student_profiles", "teacher_applications",
        "staff_memberships", "audit_logs",
    }
```

- [ ] **Step 3: Run the test and verify failure**

Run: `uv run pytest tests/backend/test_identity_schema.py -v`

Expected: FAIL because schema `app` and its tables do not exist.

- [ ] **Step 4: Implement the identity migration**

In the CLI-generated migration, create the private `app` schema, the two enums, and the five tables exactly as spec sections 5 and 10 define. Include:

```sql
create schema if not exists app;
create type app.teacher_application_status as enum ('pending', 'approved', 'rejected');
create type app.staff_role as enum ('teacher', 'admin');

create table app.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index user_profiles_email_ci on app.user_profiles (lower(email));
```

Add constraints for birth dates not being in the future, one pending teacher application per user, staff roles, timestamps, and JSON audit details. Create a non-login role `app_backend`, revoke schema access from `anon` and `authenticated`, grant `app_backend` only the required schema/table/sequence operations, enable RLS on all five tables, and add explicit `app_backend` policies. `backend/core/db.py` must execute `set local role app_backend` at the start of every application transaction; migrations continue to run as the database owner.

- [ ] **Step 5: Reset the local database and verify schema**

Run:

```bash
npx supabase start
npx supabase db reset
uv run pytest tests/backend/test_identity_schema.py -v
npx supabase migration list --local
```

Expected: schema test passes and the identity migration appears as applied locally.

- [ ] **Step 6: Commit the identity schema**

```bash
git add supabase tests/backend/test_identity_schema.py
git commit -m "feat: add identity database schema"
```

### Task 3: JWT Authentication and Shared API Errors

**Files:**
- Create: `backend/core/config.py`
- Create: `backend/core/db.py`
- Create: `backend/core/errors.py`
- Create: `backend/core/auth.py`
- Create: `backend/identity/models.py`
- Modify: `backend/main.py`
- Test: `tests/backend/test_auth.py`
- Test: `tests/backend/test_errors.py`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_JWT_AUDIENCE`, `DATABASE_URL`.
- Produces: `AuthenticatedUser(user_id: UUID, email: str, provider: str, email_verified: bool)`, `get_current_user()`, `require_google_user()`, and `ApiError(code, message, status_code)`.

- [ ] **Step 1: Write failing JWT and error-envelope tests**

```python
async def test_expired_jwt_returns_stable_error(client, expired_token):
    response = await client.get("/api/me", headers={"Authorization": f"Bearer {expired_token}"})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"

async def test_teacher_dependency_rejects_password_provider(client, password_token):
    response = await client.post("/api/teacher-applications", headers={"Authorization": f"Bearer {password_token}"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "GOOGLE_AUTH_REQUIRED"
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `uv run pytest tests/backend/test_auth.py tests/backend/test_errors.py -v`

Expected: FAIL because authentication dependencies and error handlers do not exist.

- [ ] **Step 3: Implement authentication and errors**

```python
@dataclass(frozen=True)
class AuthenticatedUser:
    user_id: UUID
    email: str
    provider: str
    email_verified: bool

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> AuthenticatedUser:
    claims = await jwt_verifier.verify(credentials.credentials)
    return AuthenticatedUser(
        user_id=UUID(claims["sub"]),
        email=claims["email"].lower(),
        provider=extract_current_provider(claims),
        email_verified=bool(claims.get("email_confirmed_at") or claims.get("email_verified")),
    )
```

Use the Supabase JWKS endpoint, cache keys with a bounded TTL, restrict accepted algorithms, and validate issuer, expiry, and configured audience. Implement Google-provider verification from trusted Supabase claims or the Auth user endpoint; never accept a provider value from request JSON. Register a single `ApiError` handler that adds a request ID and never exposes exception internals.

- [ ] **Step 4: Run authentication tests**

Run:

```bash
uv run pytest tests/backend/test_auth.py tests/backend/test_errors.py -v
uv run ruff check backend tests/backend
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit authentication primitives**

```bash
git add backend tests/backend
git commit -m "feat: verify Supabase users in FastAPI"
```

### Task 4: Student Onboarding and Self-Service Profile

**Files:**
- Create: `backend/identity/schemas.py`
- Create: `backend/identity/repository.py`
- Create: `backend/identity/service.py`
- Create: `backend/identity/router.py`
- Modify: `backend/main.py`
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/proxy.ts`
- Create: `src/lib/api/client.ts`
- Create: `src/app/auth/login/page.tsx`
- Create: `src/app/auth/signup/page.tsx`
- Create: `src/app/auth/callback/route.ts`
- Create: `src/app/onboarding/page.tsx`
- Create: `src/app/student/page.tsx`
- Test: `tests/backend/test_identity_service.py`
- Test: `tests/backend/test_identity_api.py`
- Test: `src/app/onboarding/page.test.tsx`

**Interfaces:**
- Consumes: `AuthenticatedUser`, database schema, Supabase SSR clients.
- Produces: `StudentProfileInput`, `StudentProfileView`, `POST/PATCH /api/students/profile`, `GET /api/me`, and authenticated student route guards.

- [ ] **Step 1: Write failing onboarding domain and UI tests**

```python
async def test_student_onboarding_creates_profile(identity_service, verified_student):
    profile = await identity_service.upsert_student_profile(
        verified_student,
        name="김민준",
        birth_date=date(2012, 4, 3),
        phone="01012345678",
        guardian_phone="01098765432",
    )
    assert profile.include_in_statistics is True
```

```tsx
it("submits normalized student profile fields", async () => {
  render(<OnboardingPage />);
  await user.type(screen.getByLabelText("이름"), "김민준");
  await user.type(screen.getByLabelText("생년월일"), "2012-04-03");
  await user.type(screen.getByLabelText("학생 연락처"), "010-1234-5678");
  await user.type(screen.getByLabelText("보호자 연락처"), "010-9876-5432");
  await user.click(screen.getByRole("button", { name: "가입 완료" }));
  expect(mockApi.post).toHaveBeenCalledWith("/api/students/profile", expect.objectContaining({ phone: "01012345678" }));
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `uv run pytest tests/backend/test_identity_service.py tests/backend/test_identity_api.py -v && npm test -- src/app/onboarding/page.test.tsx`

Expected: FAIL because profile service, routes, and page do not exist.

- [ ] **Step 3: Implement student identity APIs**

```python
class StudentProfileInput(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    birth_date: date
    phone: str
    guardian_phone: str

    @field_validator("phone", "guardian_phone")
    @classmethod
    def normalize_phone(cls, value: str) -> str:
        digits = re.sub(r"\D", "", value)
        if not 10 <= len(digits) <= 11:
            raise ValueError("올바른 연락처를 입력해 주세요.")
        return digits
```

Implement one transaction that upserts `user_profiles` and `student_profiles`. Reject unverified email/password users with `EMAIL_NOT_VERIFIED`; Google users pass with their verified provider identity. `GET /api/me` returns onboarding completion plus student/staff capabilities without leaking other users.

- [ ] **Step 4: Implement Supabase SSR and student pages**

Create browser/server Supabase clients using publishable credentials, PKCE callback exchange with an allowlisted internal `next` path, login/signup forms, onboarding, and a minimal `/student` protected page. The FastAPI client obtains the current Supabase access token and sends it only in the `Authorization` header.

```ts
export async function apiFetch<T>(path: `/api/${string}`, init: RequestInit = {}): Promise<T> {
  const supabase = createBrowserSupabaseClient();
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ApiClientError("AUTH_REQUIRED");
  const response = await fetch(path, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${data.session.access_token}` },
  });
  return parseApiResponse<T>(response);
}
```

- [ ] **Step 5: Verify onboarding end to end at the component/API level**

Run:

```bash
uv run pytest tests/backend/test_identity_service.py tests/backend/test_identity_api.py -v
npm test -- src/app/onboarding/page.test.tsx
npm run typecheck
npm run lint
```

Expected: all focused checks pass.

- [ ] **Step 6: Commit student onboarding**

```bash
git add backend src tests
git commit -m "feat: add student self registration"
```

### Task 5: Teacher Applications and Administrator Roles

**Files:**
- Modify: `backend/identity/schemas.py`
- Modify: `backend/identity/repository.py`
- Modify: `backend/identity/service.py`
- Modify: `backend/identity/router.py`
- Create: `src/app/teacher/login/page.tsx`
- Create: `src/app/teacher/apply/page.tsx`
- Create: `src/app/teacher/applications/page.tsx`
- Create: `src/app/admin/staff/page.tsx`
- Test: `tests/backend/test_staff_workflow.py`
- Test: `src/app/teacher/apply/page.test.tsx`

**Interfaces:**
- Consumes: `AuthenticatedUser`, identity repositories, `INITIAL_ADMIN_EMAIL`.
- Produces: `POST/GET /api/teacher-applications`, administrator application decisions, staff role changes, and `require_teacher`/`require_admin` dependencies.

- [ ] **Step 1: Write failing staff workflow tests**

```python
async def test_google_user_requires_admin_approval(staff_service, google_user):
    application = await staff_service.apply(google_user, name="김교사", phone="01011112222")
    assert application.status == "pending"
    assert await staff_service.has_teacher_access(google_user.user_id) is False

async def test_last_admin_cannot_be_demoted(staff_service, sole_admin):
    with pytest.raises(LastAdminProtected):
        await staff_service.set_role(sole_admin, sole_admin.user_id, "teacher")
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `uv run pytest tests/backend/test_staff_workflow.py -v && npm test -- src/app/teacher/apply/page.test.tsx`

Expected: FAIL because staff services and pages do not exist.

- [ ] **Step 3: Implement staff business rules and API dependencies**

```python
async def require_admin(
    user: AuthenticatedUser = Depends(get_current_user),
    repository: IdentityRepository = Depends(get_identity_repository),
) -> AuthenticatedUser:
    if await repository.staff_role(user.user_id) != StaffRole.ADMIN:
        raise ForbiddenError()
    return user
```

Implement idempotent initial-admin bootstrap when the verified Google email exactly matches `INITIAL_ADMIN_EMAIL`; teacher application/reapplication; approve/reject; teacher-to-admin promotion; admin-to-teacher demotion; and a transaction that locks staff memberships before enforcing at least one remaining admin. Every decision and role change writes an audit entry.

- [ ] **Step 4: Implement teacher and administrator pages**

Teacher login starts Google OAuth with a signed intent/return path for `/teacher/apply`. The application page renders `none`, `pending`, `rejected`, and `approved` states. Administrator pages list pending applications and current staff with explicit confirmation for role changes.

```tsx
function ApplicationState({ status }: { status: "none" | "pending" | "rejected" | "approved" }) {
  if (status === "pending") return <p>교사 가입 승인을 기다리고 있습니다.</p>;
  if (status === "rejected") return <TeacherApplicationForm resubmission />;
  if (status === "approved") return <Link href="/teacher">교사 대시보드로 이동</Link>;
  return <TeacherApplicationForm />;
}
```

- [ ] **Step 5: Verify staff flows**

Run:

```bash
uv run pytest tests/backend/test_staff_workflow.py tests/backend/test_identity_api.py -v
npm test -- src/app/teacher/apply/page.test.tsx
npm run typecheck
npm run lint
```

Expected: all checks pass, including password-provider rejection for teacher applications.

- [ ] **Step 6: Commit staff workflows**

```bash
git add backend src tests
git commit -m "feat: add approved teacher access"
```

### Task 6: Identity Browser Flow and Vercel-Compatible Verification

**Files:**
- Create: `proxy.ts`
- Create: `playwright.config.ts`
- Create: `tests/e2e/identity.spec.ts`
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: all identity endpoints and pages from Tasks 1-5.
- Produces: cookie refresh proxy, reproducible local setup, and verified identity milestone.

- [ ] **Step 1: Write failing browser tests**

Run `npx playwright install chromium` once before the first Playwright execution.

```ts
test("root routes users to separate student and teacher entry points", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "학생으로 로그인" }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await page.goto("/");
  await page.getByRole("link", { name: "교사로 로그인" }).click();
  await expect(page).toHaveURL(/\/teacher\/login$/);
});
```

Add authenticated fixture tests for onboarding redirect, pending-teacher denial, approved-teacher access, and administrator-only pages.

- [ ] **Step 2: Run Playwright and verify failure**

Run: `npm run test:e2e -- tests/e2e/identity.spec.ts`

Expected: at least the cookie-refresh and protected-route cases fail before `proxy.ts` and fixtures are complete.

- [ ] **Step 3: Implement SSR cookie refresh and test fixtures**

Implement `proxy.ts` using the current Supabase SSR proxy pattern. Match protected student, teacher, and admin paths; refresh cookies only, while FastAPI remains the authorization authority. Add deterministic local test users through test-only fixtures that cannot load when `APP_ENV` is not `test`.

```ts
// proxy.ts
import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = { matcher: ["/student/:path*", "/teacher/:path*", "/admin/:path*"] };
```

- [ ] **Step 4: Document local identity setup**

Document exact commands:

```bash
npm install
uv sync
npx supabase start
npx supabase db reset
npm run dev
uv run uvicorn api.index:app --reload --port 8000
```

Document Supabase Google callback configuration, email confirmation through local Inbucket, initial admin email, and running the combined Vercel shape with `npm run vercel:dev`.

- [ ] **Step 5: Run the identity milestone verification**

Run:

```bash
npm test
uv run pytest tests/backend -v
npm run typecheck
npm run lint
npm run build
npm run test:e2e -- tests/e2e/identity.spec.ts
```

Expected: every command passes. Then run `npm run vercel:dev` and manually verify `GET /api/health` plus the two root login choices.

- [ ] **Step 6: Commit the verified identity milestone**

```bash
git add proxy.ts playwright.config.ts tests/e2e README.md .env.example
git commit -m "test: verify identity flows locally"
```
