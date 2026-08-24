# Kiosk Device Sessions and Logo Contrast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build named kiosk sessions at `/qr`, permanent admin deletion that preserves attendance and resets the affected kiosk, and contrast-aware church logos.

**Architecture:** Extend the existing kiosk session model with a session-level device name and snapshot that name into QR attendance records. Administrative deletion hard-deletes the session under the existing database transaction, while `ON DELETE SET NULL` preserves attendance. Keep the shared password and cookie/token design unchanged, and express logo contrast through a small typed brand-component API.

**Tech Stack:** Next.js App Router, React, TypeScript, shadcn/ui, FastAPI, Pydantic, psycopg, PostgreSQL/Supabase migrations, Vitest, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-24-kiosk-device-sessions-and-logo-contrast-design.md`

## Global Constraints

- `/qr` is the only kiosk page; `/login` must return 404 and must not redirect.
- Device names are required, trimmed, 1-80 characters, and may be reused by later sessions.
- Kiosk authentication continues to use the existing shared `KIOSK_PASSWORD_HASH` secret and IP-based rate limit identity.
- Administrative deletion permanently removes the kiosk session but never deletes attendance history.
- A deleted kiosk must perform `window.location.replace("/qr")` on the next terminal kiosk-auth error.
- Black/dark logos render on light backgrounds; white logos render on the dark teacher sidebar.
- Preserve all unrelated dirty work and do not commit, push, merge, deploy, stash, reset, or clean.

---

### Task 1: Database model for named sessions and preserved attendance

**Files:**
- Create: `supabase/migrations/20260824XXXXXX_named_kiosk_sessions.sql`
- Test: `tests/backend/test_attendance_schema.py`
- Test: `tests/backend/test_kiosk_api.py`

**Interfaces:**
- Produces: `app.kiosk_sessions.device_name text not null`; `app.attendance_scans.kiosk_device_name text`; attendance FK with `ON DELETE SET NULL`.

- [ ] **Step 1: Write failing schema tests** asserting the two columns, device-name constraint, delete action, and preservation of a QR scan after deleting its kiosk session.
- [ ] **Step 2: Run `uv run pytest tests/backend/test_attendance_schema.py -q`** and confirm the new assertions fail against the old schema.
- [ ] **Step 3: Add the migration** to backfill legacy device names, snapshot existing QR device names, rebuild the foreign key, and replace the QR source consistency constraint.
- [ ] **Step 4: Apply the migration to the configured local/hosted development database using the repository's existing Supabase workflow**, then rerun the schema tests and confirm they pass.

### Task 2: Backend device-name lifecycle and hard deletion

**Files:**
- Modify: `backend/kiosk/schemas.py`
- Modify: `backend/kiosk/repository.py`
- Modify: `backend/kiosk/service.py`
- Modify: `backend/kiosk/router.py`
- Modify: `backend/admin/router.py`
- Modify: `tests/backend/test_kiosk_service.py`
- Modify: `tests/backend/test_kiosk_api.py`
- Modify: `tests/backend/test_admin_api.py`

**Interfaces:**
- Consumes: database columns from Task 1.
- Produces: `KioskSessionService.login(device_name: str, password: str, rate_limit_key_hash: str)`; named session response models; `delete_as_admin(session_id: UUID, actor_id: UUID)`.

- [ ] **Step 1: Write failing tests** for trimmed device names, refresh name preservation, admin list names, hard deletion, deletion audit, 404 on repeat deletion, and token invalidation.
- [ ] **Step 2: Run the focused kiosk/admin pytest files** and confirm failures are caused by missing named-session behavior.
- [ ] **Step 3: Extend Pydantic and repository records** with `device_name`, pass it into session creation, and return it from create/rotate/active/list queries.
- [ ] **Step 4: Replace admin soft revocation with a locked delete transaction** that inserts `kiosk.session_deleted` and deletes the session row.
- [ ] **Step 5: Update router/service calls** so the login request passes the normalized device name without changing the IP-based rate-limit hash.
- [ ] **Step 6: Run `uv run pytest tests/backend/test_kiosk_service.py tests/backend/test_kiosk_api.py tests/backend/test_admin_api.py -q`** and confirm all focused backend tests pass.

### Task 3: Attendance device-name snapshot

**Files:**
- Modify: `backend/attendance/models.py`
- Modify: `backend/attendance/repository.py`
- Modify: `backend/attendance/service.py`
- Modify: `backend/attendance/schemas.py` if projections expose the snapshot.
- Modify: `tests/backend/test_attendance_service.py`
- Modify: `tests/backend/test_attendance_api.py`
- Modify: `tests/backend/test_attendance_concurrency.py`

**Interfaces:**
- Consumes: `kiosk_sessions.device_name` and `attendance_scans.kiosk_device_name` from Task 1.
- Produces: `lock_active_kiosk_session(...) -> str | None`; QR insert accepts `kiosk_device_name: str`; `AttendanceScan.kiosk_device_name: str | None`.

- [ ] **Step 1: Write failing attendance tests** proving a scan snapshots the locked device name and survives later hard deletion.
- [ ] **Step 2: Run the focused attendance tests** and confirm the new expectations fail.
- [ ] **Step 3: Add `kiosk_device_name` to scan projections and model mapping**, return the name from the shared session lock, and insert it with every QR scan.
- [ ] **Step 4: Update test fakes and concurrency assertions** to match the string-or-null lock interface.
- [ ] **Step 5: Run `uv run pytest tests/backend/test_attendance_service.py tests/backend/test_attendance_api.py tests/backend/test_attendance_concurrency.py -q`** and confirm they pass.

### Task 4: `/qr` kiosk route and named login UI

**Files:**
- Delete: `src/app/login/page.tsx`
- Create: `src/app/qr/page.tsx`
- Modify: `src/features/kiosk/kiosk-screen.tsx`
- Modify: `src/features/kiosk/kiosk-screen.test.tsx`
- Modify: `src/lib/api/kiosk-client.ts`
- Modify: `tests/e2e/helpers/attendance.ts`
- Modify: `tests/e2e/ui-visual.spec.ts`

**Interfaces:**
- Consumes: named session API from Task 2.
- Produces: `KioskClient.login(deviceName: string, password: string)` and full terminal-session navigation to `/qr`.

- [ ] **Step 1: Write failing frontend tests** for the device-name field, trimmed payload, unlocked device label, `window.location.replace("/qr")`, and the removed `/login` route reference.
- [ ] **Step 2: Run `npm test -- --run src/features/kiosk/kiosk-screen.test.tsx`** and confirm failures.
- [ ] **Step 3: Move the App Router page to `/qr`**, update metadata and all kiosk E2E navigation references, without creating an alias or redirect.
- [ ] **Step 4: Extend the kiosk form and client payload** with the required device name and show the returned name in the unlocked header.
- [ ] **Step 5: Replace the terminal session-error lock transition** with a full `window.location.replace("/qr")` navigation; keep ordinary network retry behavior unchanged.
- [ ] **Step 6: Run the focused Vitest file and route/build type checks** and confirm they pass.

### Task 5: Admin permanent-delete experience

**Files:**
- Modify: `src/app/admin/kiosks/page.tsx`
- Modify: `src/app/admin/kiosks/page.test.tsx`
- Modify: `src/app/globals.css` only if the existing card layout needs a small named-title rule.

**Interfaces:**
- Consumes: admin list `device_name` and hard-delete endpoint from Task 2.
- Produces: name-first session cards and destructive permanent-delete interaction.

- [ ] **Step 1: Write failing tests** for device-name rendering, permanent-delete confirmation copy, immediate row removal, refreshed pagination, and 404/error recovery.
- [ ] **Step 2: Run `npm test -- --run src/app/admin/kiosks/page.test.tsx`** and confirm failures.
- [ ] **Step 3: Replace revoke-only UI state and copy** with `세션 영구 삭제`, show the device name as the title, retain UUID as secondary text, and remove the row optimistically only after a successful 204 response.
- [ ] **Step 4: Reload already-loaded pages after deletion** to preserve cursor pagination consistency without reintroducing the deleted row.
- [ ] **Step 5: Run the focused admin Vitest file** and confirm it passes.

### Task 6: Contrast-aware church logo

**Files:**
- Modify: `src/components/brand/brand-mark.tsx`
- Modify: `src/components/brand/brand-mark.test.tsx`
- Modify: `src/components/navigation/teacher-navigation.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `BrandMark({ tone?: "dark" | "light", className? })` and matching `BrandLockup` prop; `.brand-mark--light` for white rendering.

- [ ] **Step 1: Write failing component tests** asserting the default dark tone and explicit light-tone class.
- [ ] **Step 2: Run `npm test -- --run src/components/brand/brand-mark.test.tsx`** and confirm failures.
- [ ] **Step 3: Add the typed tone API and deterministic monochrome inversion CSS** without duplicating the large SVG asset.
- [ ] **Step 4: Pass `tone="light"` only in the dark desktop teacher sidebar; leave all light surfaces at the default tone.**
- [ ] **Step 5: Run the brand and teacher-navigation tests** and confirm they pass.

### Task 7: Integrated verification

**Files:**
- Modify test snapshots only when visual output intentionally changes.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified end-to-end behavior and a concise handoff.

- [ ] **Step 1: Run the complete frontend unit suite and backend pytest suite**; fix only regressions caused by this feature.
- [ ] **Step 2: Run lint and `npm run build`** to verify Next.js route generation includes `/qr` and excludes `/login`.
- [ ] **Step 3: Start or reuse the localhost Next.js and FastAPI servers**, verify `/qr`, `/login` 404, named kiosk login, admin name display, deletion, and the affected kiosk's return to the locked `/qr` screen.
- [ ] **Step 4: Visually inspect light and dark logo contexts at mobile and desktop widths**, updating intentional snapshots if required.
- [ ] **Step 5: Review `git diff --check` and the scoped diff**, ensuring unrelated dirty files were not overwritten and no secrets were added.
