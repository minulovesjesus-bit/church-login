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
  constraint attendance_scans_student_request_unique
    unique (student_id, request_id),
  constraint attendance_scans_source_fields_consistent check (
    (
      source <> 'QR'
      or (kiosk_session_id is not null and qr_issued_at is not null)
    )
    and (source <> 'MANUAL' or recorded_by is not null)
  ),
  constraint attendance_scans_void_metadata_complete check (
    (voided_at is null and voided_by is null and void_reason is null)
    or
    (
      voided_at is not null
      and voided_by is not null
      and void_reason is not null
      and length(btrim(void_reason)) >= 1
    )
  )
);

create table app.rate_limit_buckets (
  bucket_key_hash text not null,
  action text not null,
  window_started_at timestamptz not null,
  attempt_count integer not null,
  blocked_until timestamptz,
  updated_at timestamptz not null,
  primary key (bucket_key_hash, action)
);

create index attendance_scans_student_date_scanned_at_idx
  on app.attendance_scans (student_id, attendance_date, scanned_at);

create index kiosk_sessions_active_refresh_expires_at_idx
  on app.kiosk_sessions (refresh_expires_at)
  where revoked_at is null;

create index attendance_scans_non_voided_student_date_scanned_at_idx
  on app.attendance_scans (student_id, attendance_date, scanned_at)
  where voided_at is null;

revoke all on app.kiosk_sessions,
              app.attendance_scans,
              app.rate_limit_buckets
  from public, anon, authenticated;

grant select, insert, update, delete
  on app.kiosk_sessions,
     app.rate_limit_buckets
  to app_backend;

grant select, insert on app.attendance_scans to app_backend;
grant update (voided_at, voided_by, void_reason)
  on app.attendance_scans
  to app_backend;

alter table app.kiosk_sessions enable row level security;
alter table app.attendance_scans enable row level security;
alter table app.rate_limit_buckets enable row level security;

create policy kiosk_sessions_app_backend_all
  on app.kiosk_sessions
  for all
  to app_backend
  using (true)
  with check (true);

create policy attendance_scans_app_backend_select
  on app.attendance_scans
  for select
  to app_backend
  using (true);

create policy attendance_scans_app_backend_insert
  on app.attendance_scans
  for insert
  to app_backend
  with check (true);

create policy attendance_scans_app_backend_update
  on app.attendance_scans
  for update
  to app_backend
  using (true)
  with check (true);

create policy rate_limit_buckets_app_backend_all
  on app.rate_limit_buckets
  for all
  to app_backend
  using (true)
  with check (true);
