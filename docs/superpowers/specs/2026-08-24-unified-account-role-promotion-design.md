# Unified Account and Teacher Promotion Design

Date: 2026-08-24

## Context

The current product has separate student and teacher entry points. Teacher authentication uses a special Google OAuth intent, followed by a teacher application and admin approval. This duplicates authentication paths and has produced a redirect loop in local development: Supabase completes Google OAuth and the PKCE exchange, but the protected teacher page receives `401` from `/api/me` and returns to `/teacher/login`.

The replacement model has one account lifecycle. Every person first creates or signs into a student account. Teacher access is an authorization capability granted later by an administrator; it is not a separate signup method.

## Product Contract

- The root route presents one primary `로그인하기` action.
- Google OAuth and email/password remain available on the unified login page.
- Every new account completes student onboarding before receiving normal application access.
- A student can be promoted to teacher only by an existing administrator.
- Promotion preserves the student profile, attendance history, statistics, and QR capability.
- A promoted teacher or administrator is sent to the teacher dashboard after login.
- A non-promoted account is sent to the student dashboard after login.
- Authentication provider does not grant staff access. A promoted email/password account and a promoted Google account have the same teacher authorization.
- Initial administrator bootstrap remains restricted to the configured, verified Google accounts so a password-only account cannot claim an administrator role.

## Routes and Navigation

### Public entry points

- `/` contains one `로그인하기` button linking to `/login`.
- `/login` is the only interactive sign-in page.
- `/auth/signup` remains the email/password signup page and creates no staff authorization.
- `/teacher/login` redirects to `/login` for backward compatibility.
- `/teacher/apply` redirects to the authenticated destination and no longer accepts applications.
- `/auth/teacher/start` redirects to `/login`; it no longer starts OAuth or writes teacher-intent cookies.

### Post-authentication continuation

All successful login methods end at `/auth/continue`.

The continuation page obtains the current Supabase session, calls `/api/me`, and applies this ordered routing rule:

1. No valid session or `AUTH_REQUIRED`: `/login`.
2. Student onboarding incomplete: `/onboarding`.
3. `capabilities.admin` or `capabilities.teacher`: `/teacher`.
4. Otherwise: `/student`.

The continuation page renders a loading state while deciding and an actionable retry state for transient failures. It must not expose role decisions through user-editable JWT metadata.

Email/password login, Google login, email confirmation, and OAuth callback all use this same continuation route. The callback exchanges the PKCE code before redirecting.

## Authorization Model

`app.staff_memberships` remains the source of truth for `teacher` and `admin` capabilities. `app.student_profiles` and `app.staff_memberships` may coexist for one user.

Teacher and administrator API guards require:

- a valid Supabase user; and
- the appropriate database membership.

They do not require a particular authentication provider. The existing last-admin protection remains unchanged. Initial-admin bootstrap is the only provider-sensitive operation and continues to require a verified Google identity listed in `INITIAL_ADMIN_EMAILS`. Each listed identity can bootstrap once; the legacy `INITIAL_ADMIN_EMAIL` setting remains supported for one account.

The application must not use `user_metadata` for roles. Role changes take effect through database lookup on each protected request, so demotion or promotion does not wait for JWT refresh.

## Student-to-Teacher Promotion

The student information page exposes `교사로 승격` only when the signed-in actor has the admin capability and the selected student has no staff membership.

The action calls a new admin endpoint:

`POST /api/admin/students/{user_id}/promote-to-teacher`

The backend performs the operation in one transaction:

1. Lock staff memberships using the existing serialization mechanism.
2. Confirm the actor is an admin.
3. Confirm the target has a student profile.
4. Insert a `teacher` staff membership with `approved_by` set to the actor.
5. Record an audit log containing the target ID and assigned role.
6. Return the updated student management view with `staff_role: "teacher"`.

Promotion is idempotent for an existing teacher: it returns the current teacher state. Promoting an administrator is rejected as a conflict rather than silently reducing privileges. Unknown or non-student targets return `404`.

The initial implementation does not add a teacher-to-student demotion action. Existing admin role management continues to manage teacher/admin changes; staff access revocation can be designed separately with explicit audit and last-admin behavior.

## Student Management UI

Teacher student-list responses add nullable `staff_role` (`teacher`, `admin`, or `null`). This avoids a second request per row and lets both table and card views show staff status.

The student editor includes a staff section:

- Non-admin teachers see staff status as read-only.
- Admins see `교사로 승격` for ordinary students.
- Existing teachers and admins show a status badge instead of the promotion action.
- Promotion uses a confirmation dialog because it grants privileged access.
- While pending, the confirmation action is disabled and shows a spinner.
- Success updates the selected student and list in place; API errors appear in an alert without discarding edits.

## Legacy Teacher Applications

Teacher applications are retired from user-facing flows:

- Remove the application link and admin application navigation item.
- Redirect legacy teacher application pages to the unified flow.
- Keep existing application tables and records in this change to avoid destructive migration and preserve audit history.
- Keep existing application endpoints registered for backward compatibility, but remove all first-party frontend callers. Endpoint deletion and data cleanup require a separate migration plan.

## Error Handling

- Authentication failures return to `/login` with a user-readable message.
- A valid account without staff membership is treated as a student, not as an error.
- Authorization failures from promotion return `403` and do not disclose whether unrelated users exist.
- Duplicate concurrent promotions produce one teacher membership and one effective audit transition.
- Backend validation and database constraints remain authoritative even when the UI hides an action.

## Compatibility and Rollout

- Preserve existing Supabase users, student profiles, attendance records, staff memberships, and audit logs.
- Do not require a new database enum or destructive migration.
- Existing admin and teacher accounts continue to use their current memberships.
- Old bookmarked teacher URLs converge on the unified login instead of looping.
- Vercel compatibility is preserved: the continuation is a Next.js client route and FastAPI endpoints remain stateless functions backed by Supabase Postgres.

## Testing and Verification

### Frontend unit tests

- Root renders exactly one login action.
- Legacy teacher routes redirect to unified login/continuation.
- Google and password login both target `/auth/continue`.
- Continuation routes unauthenticated, incomplete, student, teacher, and admin states correctly.
- Student table/card/editor render staff status and admin-only promotion controls.
- Promotion confirmation, pending, success, conflict, and error states are covered.

### Backend tests

- Password and Google users with teacher membership pass teacher guards.
- Users without staff membership fail staff-only endpoints regardless of provider.
- Initial-admin bootstrap still requires one of the configured verified Google identities.
- Admin promotion succeeds, is idempotent, preserves student data, and writes one effective audit transition.
- Teacher/non-admin promotion returns `403`; non-student target returns `404`; admin target conflict preserves role.
- Concurrent promotion attempts leave one membership.

### Integration verification

- Complete Google login and email/password login through `/auth/continue`.
- Verify a student lands on `/student` and a promoted teacher/admin lands on `/teacher`.
- Verify `/teacher/login` no longer initiates a separate OAuth flow.
- Verify the promotion control in mobile card and desktop table experiences.
- Run Vitest, pytest, lint, TypeScript, build, and the relevant browser end-to-end tests.

## Out of Scope

- Deleting historic teacher application records.
- Teacher self-application or self-promotion.
- Staff access revocation/demotion to student.
- Replacing Supabase Auth or the existing student onboarding data model.
