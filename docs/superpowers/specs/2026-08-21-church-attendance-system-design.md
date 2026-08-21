# Church Attendance System Design

**Date:** 2026-08-21
**Status:** Approved in conversation
**Target:** Local feature completion with a Vercel-compatible deployment shape

## 1. Purpose

Build a responsive church attendance service for students, teachers, and administrators. Students register themselves, view their own attendance history and statistics, read weekly church events, and scan a short-lived QR code displayed on a shared church device. Teachers manage students, attendance records, and events. Administrators additionally approve teacher applications, promote teachers to administrators, and revoke shared-device sessions.

The first delivery target is a complete and verified local system. The repository must nevertheless use the file layout, runtime assumptions, and stateless backend model required for a later Vercel deployment.

## 2. Scope

### Included

- Next.js App Router frontend with responsive mobile, tablet, and desktop layouts
- FastAPI backend exposed through Vercel's Python runtime
- Supabase Auth with Google OAuth and email/password registration
- Student self-registration and profile management
- Teacher application and administrator approval workflow
- Multiple administrators with last-administrator protection
- Shared-device password login with renewable sessions
- Rotating 20-second attendance QR codes
- Repeated `IN -> OUT -> IN -> OUT` attendance scans with a 10-second cooldown
- Student attendance history and personal statistics
- Teacher-wide attendance dashboards and filters
- Student statistics inclusion toggle
- One-time and weekly recurring church events
- Audit logging for privileged changes
- Automated frontend, backend, database, and end-to-end verification

### Not included in the first version

- Attendance sessions linked to particular worship services or events
- Attendance-rate percentages that require a planned-session denominator
- Native iOS or Android applications
- SMS authentication
- Teachers creating student accounts
- Single-occurrence overrides for a weekly event series
- Production deployment or production-domain configuration

## 3. Architecture

```text
Browser
  |
  |-- Next.js App Router
  |     |-- responsive student UI
  |     |-- responsive teacher/admin UI
  |     `-- Supabase Auth session handling
  |
  `-- /api/* requests
          |
          v
      FastAPI on Vercel Python Function
          |-- Supabase JWT verification
          |-- role and resource authorization
          |-- kiosk session and QR handling
          |-- attendance transactions
          |-- student, event, and statistics services
          `-- audit logging
                   |
                   v
               Supabase
                 |-- Auth
                 `-- PostgreSQL
```

### Frontend boundary

Next.js owns rendering, navigation, form state, responsive behavior, camera access, and Supabase Auth session handling. The browser may use the Supabase publishable key only for authentication. It does not read or write application tables directly.

### Backend boundary

FastAPI is the only application-data API. It validates the Supabase access token for user requests, reads current application roles from PostgreSQL, authorizes each resource operation, and executes all business logic. It remains stateless between invocations; durable state belongs in PostgreSQL or signed/opaque tokens.

### Vercel shape

- `api/index.py` exposes a FastAPI variable named `app` and imports the organized backend application.
- Backend modules live under `backend/` and are reachable from the Vercel entrypoint.
- All FastAPI routes use the `/api/*` prefix.
- Next.js does not define conflicting `app/api` route handlers.
- Python dependencies are pinned in `pyproject.toml` with a committed lockfile when supported.
- Vercel Python bundle exclusions are configured for tests, fixtures, and local artifacts.
- The final local smoke test includes `vercel dev` so the production routing shape is exercised.
- The backend does not depend on local memory, local file writes, sticky sessions, or long-running processes.

Vercel's FastAPI runtime and the Supabase SSR/Auth APIs must be rechecked against their official documentation immediately before implementation because both can change.

### Vercel Hobby/free-tier operating contract

Verified against Vercel's official FastAPI, Function limits, Fluid Compute, and Hobby-plan documentation on 2026-08-21:

- Vercel packages the FastAPI application as one Python Function. Keep `api/index.py` as the single entrypoint and enable Fluid Compute explicitly in `vercel.json`.
- Stay within the conservative 500 MB compressed Python bundle boundary documented for FastAPI. Tests, local fixtures, caches, and development-only assets are excluded from the Function bundle, and heavyweight dependencies require an explicit size review.
- The implementation targets the Hobby standard instance envelope of 2 GB memory and 1 vCPU. Normal API work must finish well under 10 seconds even though current Fluid Compute documentation allows a longer maximum; no user flow may depend on a long-running request.
- Current Hobby included usage is 1,000,000 Function invocations, 4 active CPU-hours, and 360 GB-hours of provisioned memory per usage period. The service uses bounded, visibility-aware polling and stops polling on hidden/unmounted pages. One continuously displayed kiosk refreshing exactly once per 20 seconds is approximately 129,600 invocations per 30 days, before scans and dashboards.
- QR rotation performs one request per 20-second token and never polls every second. Dashboard refresh defaults to at least 30 seconds, pauses while the page is hidden, and applies retry backoff.
- All durable state remains in Supabase. Production uses a Supabase/Supavisor transaction-pooler `DATABASE_URL`, bounded connect/query timeouts, short transactions, and explicit connection cleanup. Migrations never run inside a Function invocation.
- No route relies on post-response background work, WebSockets, sticky sessions, writable local files, or an in-memory scheduler. Warm-instance caches are opportunistic only and remain bounded; correctness survives cold starts and instance replacement.
- Deployment verification must run `vercel build` or an equivalent Vercel build plus `vercel dev`, inspect the generated Python Function/bundle, and exercise `/api/health`, one authenticated API request, and one database-backed request.
- Hobby is free only within its quotas and is governed by Vercel's current personal/non-commercial fair-use terms. The code is technically Hobby-compatible, but an organization-wide church production deployment requires an explicit plan/eligibility check before launch; exceeding Hobby quotas can pause the affected feature until usage resets.

## 4. Identity and authorization

### Student registration

Students may register with either:

- Google OAuth, which supplies a verified email; or
- Supabase email/password registration, which requires email confirmation before application access.

After authentication, a new student completes onboarding with:

- name;
- birth date;
- student phone number; and
- guardian phone number.

Age is never stored. It is calculated from the birth date when displayed. No teacher approval is required, and a completed profile can immediately use student features.

### Teacher registration

Teacher access is Google-only. A person enters through the teacher login flow, completes Google authentication, and submits a teacher application. FastAPI verifies the authenticated identity and Google provider rather than trusting a frontend flag.

Application states are `pending`, `approved`, and `rejected`. A pending or rejected applicant cannot access teacher APIs. An administrator may approve the applicant as a teacher. An approved teacher can later be promoted to administrator.

### Roles

- **Student:** edit their own profile, view their own history and statistics, view events, and scan attendance QR codes.
- **Teacher:** view and edit student information, toggle statistics inclusion, view and correct attendance, and manage events.
- **Administrator:** all teacher abilities plus teacher-application decisions, teacher/admin role changes, and kiosk-session revocation.

Staff membership is stored in application tables, not user-editable Supabase metadata. FastAPI loads current membership from the database for each protected request so role removal takes effect without waiting for a JWT refresh.

The initial administrator is bootstrapped once through `INITIAL_ADMIN_EMAIL`. The matching user must authenticate with Google. Subsequent staff changes occur only through the administrator dashboard. The system must reject any operation that would leave zero administrators.

### Kiosk identity

The shared-device password is separate from every Google or Supabase password. Only an Argon2 hash is stored in server configuration. A successful `/login` submits the password to FastAPI and creates a durable kiosk session.

Kiosk authentication uses:

- a short-lived `HttpOnly` access cookie;
- a longer-lived opaque refresh cookie;
- a hash of the refresh token stored in `kiosk_sessions`; and
- rotation of the refresh token whenever it is used.

The displayed page renews its session automatically while in use. An administrator can revoke a kiosk session. An expired, revoked, or long-unused session returns the shared device to the password screen.

## 5. Data model

Application data lives in a schema that is not exposed directly through the Supabase Data API. Browser roles receive no direct table grants. RLS remains enabled where practical as defense in depth, while routine application access uses a narrowly granted backend database role rather than a browser-exposed service key.

### `user_profiles`

Common identity information.

- `user_id uuid primary key references auth.users(id)`
- `email text not null`
- `name text not null`
- `phone text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Email lookup uses a case-insensitive unique index. Phone numbers are normalized before storage.

### `student_profiles`

Student-only information.

- `user_id uuid primary key references user_profiles(user_id)`
- `birth_date date not null`
- `guardian_phone text not null`
- `include_in_statistics boolean not null default true`

Setting `include_in_statistics` to false does not block login, scanning, profile access, or personal history. It only removes that student from teacher-wide aggregate statistics. Teachers continue to see the student in the management table with a clear exclusion badge and can turn inclusion back on.

### `teacher_applications`

- `id uuid primary key`
- `user_id uuid not null references user_profiles(user_id)`
- `status teacher_application_status not null`
- `applied_at timestamptz not null`
- `reviewed_by uuid references user_profiles(user_id)`
- `reviewed_at timestamptz`
- `rejection_reason text`

Only one pending application per user is allowed. Rejected users may submit a later application while preserving the previous audit trail.

### `staff_memberships`

- `user_id uuid primary key references user_profiles(user_id)`
- `role staff_role not null` where the role is `teacher` or `admin`
- `approved_by uuid references user_profiles(user_id)`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

The initial administrator may have a null `approved_by` value. Staff membership and student profile records may coexist so an existing student account can later receive staff access without destroying student history.

### `kiosk_sessions`

- `id uuid primary key`
- `refresh_token_hash text not null`
- `created_at timestamptz not null`
- `last_seen_at timestamptz not null`
- `refresh_expires_at timestamptz not null`
- `revoked_at timestamptz`
- `revoked_by uuid references user_profiles(user_id)`

### `attendance_scans`

This append-oriented table is the source of truth for attendance.

- `id uuid primary key`
- `student_id uuid not null references student_profiles(user_id)`
- `attendance_date date not null`
- `direction attendance_direction not null` where direction is `IN` or `OUT`
- `scanned_at timestamptz not null`
- `kiosk_session_id uuid not null references kiosk_sessions(id)`
- `request_id uuid not null`
- `qr_issued_at timestamptz not null`
- `source attendance_source not null default 'QR'`
- `recorded_by uuid references user_profiles(user_id)`
- `voided_at timestamptz`
- `voided_by uuid references staff_memberships(user_id)`
- `void_reason text`
- unique constraint on `(student_id, request_id)`

`attendance_date` is derived from `scanned_at` in `Asia/Seoul`. Accepted QR fields are never silently rewritten. A teacher correction either marks an erroneous row as void or appends a `MANUAL` row, and both operations create an audit log. Statistics and current-state calculations ignore voided rows.

### `events`

- `id uuid primary key`
- `title text not null`
- `description text`
- `location text`
- `starts_at timestamptz not null`
- `ends_at timestamptz not null`
- `repeat_weekly boolean not null default false`
- `repeat_until date`
- `created_by uuid not null references staff_memberships(user_id)`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

When `repeat_weekly` is true, the weekday and local time come from `starts_at`. A null `repeat_until` means the series continues indefinitely. Editing or deleting affects the full series in the first version.

### `audit_logs`

- `id uuid primary key`
- `actor_id uuid references user_profiles(user_id)`
- `action text not null`
- `target_type text not null`
- `target_id text not null`
- `details jsonb not null`
- `created_at timestamptz not null`

Audit details must avoid secrets and minimize duplicated personal data.

### `rate_limit_buckets`

Durable counters for public and sensitive endpoints.

- `bucket_key_hash text not null`
- `action text not null`
- `window_started_at timestamptz not null`
- `attempt_count integer not null`
- `blocked_until timestamptz`
- `updated_at timestamptz not null`
- primary key on `(bucket_key_hash, action)`

The bucket key is a keyed hash of the relevant IP, session, or user identifier. Raw IP addresses are not stored in this table. Expired buckets are removed periodically or opportunistically during requests.

## 6. Attendance and QR flow

### QR issuance

1. A shared device authenticates on `/login`.
2. FastAPI creates or renews a valid kiosk session.
3. The QR screen requests a new signed token every 20 seconds.
4. The token contains only a kiosk-session identifier, issued time, expiry time, and random identifier.
5. The token is signed with `QR_SIGNING_SECRET`, which is separate from the kiosk-password hash and all Supabase secrets.
6. No student identifier or personal information appears in the QR code.

Each token expires 20 seconds after issuance. FastAPI also verifies that the referenced kiosk session still exists and has not been revoked. A screenshot can only be used during the remaining token lifetime; the design does not claim to eliminate intentional real-time sharing.

### Student scan

1. An authenticated student opens `/student/scan` and grants camera access.
2. The browser decodes the QR and creates a unique request ID.
3. It sends the QR token and request ID to `POST /api/attendance/scan` with the Supabase access token.
4. FastAPI validates the user JWT, student profile, QR signature, QR expiry, and kiosk-session status.
5. Inside one PostgreSQL transaction, FastAPI takes a student-and-date-scoped lock and loads the latest non-voided scan.
6. A scan less than 10 seconds after the previous accepted scan is returned as a cooldown result without inserting a row.
7. Otherwise, the next direction alternates from the latest row: no prior row or `OUT` becomes `IN`; `IN` becomes `OUT`.
8. FastAPI inserts the scan and returns the accepted direction and server timestamp.

The unique request ID makes network retries idempotent. A retry returns the original accepted result rather than changing the direction again. The database lock prevents simultaneous requests from creating two identical transitions.

### Statistics

Student statistics include:

- attendance days this week and month;
- total accepted `IN` scans;
- average completed stay duration; and
- recent scan history.

Teacher statistics include:

- unique attendees today, this week, and this month;
- students currently inside, based on each student's latest direction;
- time-of-day entry counts;
- student attendance-day counts; and
- average completed stay duration where useful.

Stay duration pairs each `IN` with the immediately following `OUT`. An unmatched final `IN` is displayed as an open stay and is excluded from average-duration calculations. Teacher aggregates exclude students whose `include_in_statistics` value is false, while those students retain full personal statistics.

## 7. Events

Teachers create, update, and delete one-time or weekly recurring events. Students see occurrences for the current week, with navigation to adjacent weeks if included during implementation.

An event contains title, description, location, start/end time, weekly-repeat selection, and optional repeat end date. Event recurrence is independent of attendance; scanning never selects or records an event.

The API expands weekly series into occurrence DTOs for the requested date range. Stored timestamps are absolute, but recurrence calculations and display use `Asia/Seoul`.

## 8. User experience and routes

### Root and public routes

- `/`: presents `교사로 로그인` and `학생으로 로그인` choices.
- `/auth/login`: student Google and email/password login.
- `/auth/signup`: student email/password registration.
- `/auth/callback`: Supabase Google OAuth code exchange.
- `/onboarding`: student profile completion.
- `/teacher/login`: teacher Google login.
- `/teacher/apply`: teacher application form and status.
- `/login`: shared-device password and, after success, the rotating QR screen.

### Student routes

- `/student`: QR call-to-action, today's state, monthly summary, and current-week events.
- `/student/scan`: focused camera scanner with permission and recovery states.
- `/student/attendance`: personal scan history and statistics.
- `/student/events`: weekly event list.
- `/student/profile`: profile editing.

On mobile, student navigation uses a bottom bar. On larger screens it becomes a wider navigation treatment while preserving the same information hierarchy.

### Teacher and administrator routes

- `/teacher`: dashboard summary and live attendance list.
- `/teacher/attendance`: date, student, and state filters with scan detail.
- `/teacher/students`: self-registered student table, editing, and statistics inclusion toggle.
- `/teacher/events`: one-time and recurring event management.
- `/teacher/applications`: teacher application decisions, visible to administrators.
- `/admin/staff`: teacher/admin promotion and demotion.
- `/admin/kiosks`: active kiosk sessions and revocation.

Desktop uses a sidebar and tables. Mobile and tablet layouts collapse navigation into a drawer or bottom navigation and turn dense table rows into cards. There is one responsive codebase, not separate mobile and desktop applications. Teachers cannot create student accounts, so the approved dashboard does not include a `학생 추가` button.

## 9. API outline

All application endpoints are served by FastAPI below `/api`.

### Identity and profiles

- `GET /api/me`
- `POST /api/students/profile`
- `PATCH /api/students/profile`
- `POST /api/teacher-applications`
- `GET /api/teacher-applications/me`

### Student attendance and events

- `POST /api/attendance/scan`
- `GET /api/attendance/me`
- `GET /api/statistics/me`
- `GET /api/events`

### Kiosk

- `POST /api/kiosk/sessions`
- `POST /api/kiosk/sessions/refresh`
- `DELETE /api/kiosk/sessions/current`
- `GET /api/kiosk/qr`

### Teacher

- `GET /api/teacher/students`
- `GET /api/teacher/students/{student_id}`
- `PATCH /api/teacher/students/{student_id}`
- `PATCH /api/teacher/students/{student_id}/statistics-inclusion`
- `GET /api/teacher/attendance`
- `POST /api/teacher/attendance/corrections` to void an erroneous scan or append a manual correction
- `GET /api/teacher/statistics`
- CRUD under `/api/teacher/events`

### Administrator

- `GET /api/admin/teacher-applications`
- `POST /api/admin/teacher-applications/{application_id}/approve`
- `POST /api/admin/teacher-applications/{application_id}/reject`
- `GET /api/admin/staff`
- `PATCH /api/admin/staff/{user_id}/role`
- `GET /api/admin/kiosk-sessions`
- `DELETE /api/admin/kiosk-sessions/{session_id}`

The final implementation plan may refine DTO names and HTTP verbs while preserving these boundaries and permissions.

## 10. Security and privacy

- Verify JWT signature, issuer, audience where applicable, expiry, and subject using the current Supabase JWKS guidance.
- Verify the Google identity provider server-side for teacher applications and staff access.
- Load staff authorization from PostgreSQL for each privileged request.
- Never use Supabase `user_metadata` for authorization.
- Never expose a Supabase secret/service-role key, database URL, kiosk hash, QR signing key, or refresh token to the browser.
- Normalize and validate email, phone, date, and identifier inputs in FastAPI even if the frontend has already validated them.
- Apply explicit CORS origins for local development and the future Vercel origin.
- Use `HttpOnly`, `SameSite`, and production `Secure` cookies for kiosk sessions; validate request origin on cookie-authenticated mutations.
- Rate-limit shared-password attempts and QR scans with durable storage rather than function memory.
- Record staff approvals, role changes, student edits, statistics-inclusion changes, attendance corrections, and kiosk revocations in `audit_logs`.
- Do not include secrets or unnecessary personal fields in logs, URLs, QR contents, or audit details.
- Keep dependencies pinned and commit JavaScript and Python lockfiles.

## 11. Error handling

FastAPI returns a stable error envelope containing a machine code, safe Korean message, and request identifier. Expected domain errors include:

- `AUTH_REQUIRED`
- `EMAIL_NOT_VERIFIED`
- `PROFILE_REQUIRED`
- `TEACHER_APPLICATION_PENDING`
- `FORBIDDEN`
- `QR_INVALID`
- `QR_EXPIRED`
- `KIOSK_SESSION_REVOKED`
- `SCAN_COOLDOWN`
- `LAST_ADMIN_PROTECTED`

An idempotent retry of an accepted attendance request returns the original success result. A cooldown is displayed as a non-destructive informational result. Camera permission denial, unsupported cameras, network failure, expired QR, and revoked kiosk sessions each receive distinct recovery instructions. Internal exception messages and database details never reach the client.

## 12. Testing and completion criteria

### Backend tests

- JWT validation and every role boundary
- student profile creation and editing
- email-verification access gate
- teacher application, approval, rejection, and reapplication
- teacher promotion, administrator promotion/demotion, and last-admin protection
- kiosk login, refresh rotation, expiry, and administrator revocation
- valid, forged, expired, and revoked-session QR tokens
- 20-second QR lifetime
- 10-second scan cooldown
- repeated `IN -> OUT -> IN -> OUT` transitions
- idempotent request retries
- simultaneous-scan transaction safety
- audited scan voiding and manual corrections
- statistics inclusion behavior
- stay-duration pairing
- one-time and weekly recurring event expansion

### Frontend tests

- root role-selection screen
- student Google and email/password entry points
- onboarding validation
- email-unverified and incomplete-profile routing
- student mobile navigation and desktop responsive layout
- camera permission denial and QR decode failure
- teacher dashboard tables, filters, and mobile card layouts
- teacher application and administrator decision screens
- kiosk password, QR refresh, auto-renewal, and revoked-session fallback

### End-to-end flows

1. Register and onboard a student.
2. Submit a teacher application through Google login.
3. Approve the teacher and promote a staff member to administrator.
4. Unlock a kiosk and display a rotating QR.
5. Scan repeatedly and observe alternating entry/exit records.
6. Confirm teacher dashboards and student personal history.
7. Exclude a student from aggregate statistics without blocking their account or scans.
8. Add a weekly recurring event and verify current-week expansion.
9. Revoke a kiosk session and verify immediate QR failure.
10. Run lint, type checking, Next.js build, FastAPI tests, database checks, and `vercel dev` smoke verification.

Google OAuth is manually verified in a real local browser in addition to automated tests. Camera behavior is tested with mocked media devices and at least one real supported device or webcam.

## 13. Local configuration

The implementation will document, at minimum:

- Supabase project URL and publishable key
- Supabase JWT/JWKS configuration
- backend database connection URL suitable for local development and Vercel/Supavisor later
- Google OAuth client ID and secret in Supabase configuration
- `INITIAL_ADMIN_EMAIL`
- Argon2 kiosk-password hash
- QR signing secret
- allowed frontend origins
- application timezone fixed to `Asia/Seoul`

`.env.example` contains names and safe descriptions only. No real credential or hash is committed.

## 14. References

- [Vercel FastAPI documentation](https://vercel.com/docs/frameworks/backend/fastapi)
- [Vercel Python runtime](https://vercel.com/docs/functions/runtimes/python)
- [Vercel Function limits](https://vercel.com/docs/functions/limitations)
- [Vercel Fluid Compute](https://vercel.com/docs/fluid-compute)
- [Vercel Hobby plan](https://vercel.com/docs/plans/hobby)
- [Supabase Next.js SSR auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client?framework=nextjs&queryGroups=framework)
- [Supabase Google login](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Supabase JWT verification](https://supabase.com/docs/guides/auth/jwts)
