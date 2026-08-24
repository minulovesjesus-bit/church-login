# Kiosk Device Sessions and Logo Contrast Design

## Goal

Move the public kiosk experience from `/login` to `/qr`, identify every kiosk session by a human-readable device name, permanently delete kiosk sessions without deleting attendance history, return deleted kiosks to the locked `/qr` screen, and render the church logo with sufficient contrast on light and dark surfaces.

## Confirmed Product Decisions

- `/qr` is the only kiosk page. `/login` is removed and must return 404 rather than redirect.
- A kiosk operator enters a required device name and the existing shared administrator password.
- Device names are session labels, not a separate permanent device registry. Reusing a name for a later session is allowed.
- Administrators see the device name as the primary label and the session UUID as secondary technical information.
- Deleting a kiosk session permanently removes the session row. It is not a soft revoke.
- Attendance scans created through the deleted session remain in attendance history and statistics.
- The affected kiosk detects the deleted session on its next QR request or refresh and performs a full navigation to `/qr`, showing the locked form again.
- A deletion audit event may retain the deleted session UUID and acting administrator, but no refresh token or live session row remains.

## Route and Kiosk UI

The existing kiosk page moves from `src/app/login/page.tsx` to `src/app/qr/page.tsx`. There is no compatibility page at `src/app/login`, so Next.js returns its normal not-found response for `/login`.

The locked kiosk form contains, in order:

1. `기기 이름`: required text, trimmed, 1-80 characters, autocomplete disabled.
2. `관리자 비밀번호`: the existing shared kiosk password, validated against `KIOSK_PASSWORD_HASH`.
3. `QR 화면 열기`: creates the named session.

Changing the device name does not change the rate-limit identity. Login attempts continue to be rate-limited by the canonical client IP so a caller cannot bypass throttling by changing the label.

After unlock, the header displays the device name beside the connection state. If a QR request or refresh returns `KIOSK_SESSION_REVOKED` or `AUTH_REQUIRED`, the client calls `window.location.replace("/qr")`. A full navigation clears in-memory QR state and restores the locked form even though the URL is already `/qr`.

## API and Domain Model

`POST /api/kiosk/sessions` accepts:

```json
{
  "device_name": "본당 입구 태블릿",
  "password": "shared administrator password"
}
```

`KioskLoginInput` rejects unknown fields, blank-after-trim names, names longer than 80 characters, and missing passwords. `KioskSessionView`, `KioskSessionRecord`, and `ManagedKioskSessionRecord` include `device_name`. Refresh responses preserve the same name.

The admin list response adds `device_name`. The existing admin endpoint keeps its URL but changes semantics:

```text
DELETE /api/admin/kiosk-sessions/{session_id}
```

It locks and deletes the exact session in one database transaction and writes `kiosk.session_deleted` to `app.audit_logs`. Missing sessions return `KIOSK_SESSION_NOT_FOUND` with HTTP 404. Deleting an already deleted session therefore returns 404 rather than pretending that a retained revoked row exists.

## Database Migration and Attendance Preservation

Add `app.kiosk_sessions.device_name text`. Existing rows receive a deterministic legacy label derived from the first eight UUID characters, then the column becomes non-null with a trimmed length constraint of 1-80 characters.

Add `app.attendance_scans.kiosk_device_name text` as an immutable display snapshot. Existing QR rows are backfilled from their linked kiosk sessions. New QR scan inserts copy the current session name into this column.

Rebuild the attendance-to-kiosk foreign key with `ON DELETE SET NULL`. Update the source-field constraint so a QR attendance record requires `qr_issued_at` and `kiosk_device_name`, while `kiosk_session_id` may be null after administrative deletion. This preserves attendance history and referential integrity without retaining a kiosk session tombstone.

The attendance repository's kiosk lock returns the device name instead of a boolean. The scan service uses that locked name when inserting the attendance snapshot, ensuring the session cannot be deleted between validation and insertion.

## Admin Kiosk Management

Each admin card shows:

- Device name as the card title.
- Session UUID below it.
- Created, last-used, and expiry timestamps.
- Current active or expired state.
- A destructive `세션 영구 삭제` action.

The confirmation dialog states that the kiosk will immediately return to its password screen and that attendance history will remain. After success, the row is removed from local state and loaded pages are refreshed. There is no revoked state or disabled revoked row in the admin list for deleted sessions.

The kiosk's own `관리자 화면 잠금` action can continue to revoke its session locally; administrative deletion is the permanent removal operation requested here. Expired or locally revoked sessions remain listable until an administrator permanently deletes them.

## Logo Contrast

The official SVG is monochrome black. `BrandMark` and `BrandLockup` receive a `tone` prop:

```ts
type BrandTone = "dark" | "light";
```

- `dark` means a black/dark logo for white or light backgrounds and is the default.
- `light` means a white logo for dark backgrounds and applies a deterministic CSS inversion to the monochrome SVG.

The desktop teacher sidebar uses `tone="light"`. Auth pages, student pages, mobile teacher header, kiosk card, and kiosk header use the default dark logo because their surfaces are light.

## Error Handling and Security

- Device names are display-only metadata and never participate in authorization.
- The shared kiosk password remains server-only and is never returned.
- Hard deletion invalidates access and refresh tokens because every authenticated kiosk operation verifies that the session row still exists.
- The browser performs a full replace navigation after terminal kiosk-auth failure, preventing a stale QR from remaining visible.
- Attendance records remain immutable except for the existing correction/void workflow.

## Verification

- Frontend unit tests cover device-name submission, validation, unlocked display, terminal-session navigation to `/qr`, admin name rendering/removal, deletion copy, and logo tones.
- Backend unit/API tests cover device-name persistence, refresh preservation, admin response shape, hard-delete 404 semantics, and session invalidation.
- Database tests cover the new constraints, `ON DELETE SET NULL`, attendance snapshot preservation, and audit creation.
- Route tests and an application build verify `/qr` serves kiosk entry separately from the account `/login` route.
- Browser verification checks the light/dark logo contrast, responsive kiosk form, admin device list, and deleted-kiosk reset behavior.
