# Student Mobile Account Experience Design

**Date:** 2026-08-24
**Status:** Proposed for implementation
**Scope:** Student-facing shell, role-aware student navigation, self-profile editing, and logout

## Goal

Make every student-facing route feel like one mobile application regardless of device size. Phone, tablet, and desktop use the same narrow centered canvas and bottom navigation. Students can edit their own profile and log out from Home. Teachers and administrators retain staff-first login behavior but can enter the student experience and return through a fifth `교사 모드` navigation item.

## Confirmed Product Rules

- Completed student-only accounts land on `/student` after login.
- Teacher and administrator accounts land on `/teacher` after login.
- Student navigation has four standard items: Home, QR attendance, attendance history, and events.
- Teacher and administrator accounts see a fifth `교사 모드` item while using student routes.
- `교사 모드` links to `/teacher` and does not change stored roles or permissions.
- The existing teacher-view button is removed from the student Home header.
- Personal-information editing and logout are shown in an `내 정보` section on student Home, not as additional navigation items.
- Students may edit name, birth date, phone number, and guardian phone number. Login email is read-only.

## Student Shell and Navigation

`StudentShell` remains the shared wrapper for every `/student` route. Its content area will become a narrow, centered mobile canvas at every breakpoint. The desktop rule that moves student navigation to the top will be removed. The navigation remains fixed to the bottom and reserves safe-area space so content is not obscured.

`StudentNavigation` will load the current identity once while the persistent student layout is mounted. It renders the existing four links for normal students and appends `교사 모드` when `capabilities.teacher` or `capabilities.admin` is true. A failed capability request must not block student pages; the navigation safely falls back to four items.

The grid column count follows the rendered item count: four equal columns for students and five equal columns for staff accounts. The same behavior applies on phone, tablet, and desktop.

## Home Account Section

The Home dashboard gains an `내 정보` card after the existing attendance and weekly-event content. It shows the account email and exposes two actions:

1. `개인정보 수정` opens a mobile-friendly dialog.
2. `로그아웃` opens a confirmation dialog.

The profile dialog loads current values and contains:

- Email as a read-only value.
- Name as a required text input.
- Birth date using the existing year/month/day segmented input.
- Student phone using the existing segmented phone input.
- Guardian phone using the same segmented phone input.

Saving updates the card and closes the dialog only after the server confirms success. Server and validation errors remain visible in the dialog, and the user may retry without losing entered values.

## Self-Profile API

Add an authenticated endpoint:

`GET /api/students/profile`

It returns the existing `StudentProfileView` for the authenticated user:

```json
{
  "name": "김민준",
  "birth_date": "2012-04-03",
  "phone": "01012345678",
  "guardian_phone": "01098765432",
  "include_in_statistics": true
}
```

The endpoint reads only the caller's profile and never accepts a user ID. A missing student profile returns the existing profile-required error contract.

The existing `PATCH /api/students/profile` remains the single update path. It accepts the complete editable profile payload and continues to normalize phone numbers and reject future birth dates. `include_in_statistics` remains controlled by teachers and is not editable by the student.

Repository access will add a current-profile lookup keyed by the authenticated user's UUID. The service exposes the lookup without weakening the existing authentication checks.

## Logout Flow

After confirmation, Home calls Supabase `auth.signOut()`. On success it replaces the current route with `/login` so browser history does not reopen an authenticated page. While logout is pending, both account actions are disabled.

If Supabase returns an error, the user stays signed in and sees an actionable error. The UI must not redirect or pretend logout succeeded.

## Loading and Error Behavior

- Student Home keeps its existing authentication, onboarding, statistics, and event behavior.
- Profile loading is independent of attendance statistics. A profile failure affects only the account card.
- The account card shows a loading state while profile data is requested and a retry action for temporary failures.
- `AUTH_REQUIRED` during profile loading or saving returns the user to `/login`.
- `PROFILE_REQUIRED` returns the user to `/onboarding`.
- Navigation capability lookup failures silently retain the safe four-item student navigation.
- Profile submission prevents duplicate saves while a request is pending.

## Security and Privacy

- Self-profile reads and writes derive the target user exclusively from the verified bearer token.
- The client cannot submit or change `include_in_statistics`, roles, user IDs, or email.
- Email remains sourced from the authenticated identity response and is never written by the profile form.
- Logout clears the Supabase browser session through the supported client API.
- Existing teacher-only and administrator-only API protections remain unchanged.

## Testing

Backend coverage:

- An authenticated student can read only their own profile.
- Missing profiles return the profile-required error.
- Unauthenticated requests are rejected.
- Existing profile-update normalization and validation remain intact.

Frontend coverage:

- Student navigation renders four items for students and five for staff.
- `교사 모드` links to `/teacher` and is absent for student-only identities.
- The shell remains bottom-navigation/mobile-canvas based at all breakpoints.
- Home no longer renders the header teacher-view action.
- Profile data loads into the form, email is read-only, valid edits save, and errors are retryable.
- Logout requires confirmation, redirects only after success, and reports failure without navigation.

Integration verification:

- Full frontend tests, backend tests, TypeScript, and ESLint pass.
- Browser checks cover narrow phone, tablet, and desktop viewports.
- Teacher login still resolves to `/teacher`; student login still resolves to `/student`.

## Non-Goals

- Changing login-role routing.
- Editing email, password, roles, or statistics inclusion.
- Adding a profile navigation item or dedicated profile route.
- Redesigning teacher/admin pages.
- Committing, pushing, or deploying the implementation.

## Acceptance Criteria

1. Student routes use a narrow centered mobile layout and bottom navigation on all supported viewport sizes.
2. Student-only accounts see exactly four navigation items.
3. Teacher/admin accounts see a fifth `교사 모드` item that opens `/teacher`.
4. No teacher-view action remains in the student Home header.
5. Home exposes self-profile editing for the four approved fields with read-only email.
6. Profile updates persist through the authenticated self-profile API without exposing staff-only fields.
7. Logout confirms intent, clears the Supabase session, and returns to `/login` only on success.
8. Loading, validation, authentication, and temporary-failure states remain actionable and do not discard edits.
