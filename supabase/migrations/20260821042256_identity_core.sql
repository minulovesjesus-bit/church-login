create schema if not exists app;

create type app.teacher_application_status as enum ('pending', 'approved', 'rejected');
create type app.staff_role as enum ('teacher', 'admin');

create table app.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_timestamps_ordered check (updated_at >= created_at)
);

create unique index user_profiles_email_ci on app.user_profiles (lower(email));

create table app.student_profiles (
  user_id uuid primary key references app.user_profiles(user_id),
  birth_date date not null,
  guardian_phone text not null,
  include_in_statistics boolean not null default true,
  constraint student_profiles_birth_date_not_future check (birth_date <= current_date)
);

create table app.teacher_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.user_profiles(user_id),
  status app.teacher_application_status not null default 'pending',
  applied_at timestamptz not null default now(),
  reviewed_by uuid references app.user_profiles(user_id),
  reviewed_at timestamptz,
  rejection_reason text,
  constraint teacher_applications_review_timestamp_ordered
    check (reviewed_at is null or reviewed_at >= applied_at),
  constraint teacher_applications_review_state_consistent check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and rejection_reason is null)
    or
    (status = 'approved' and reviewed_by is not null and reviewed_at is not null and rejection_reason is null)
    or
    (
      status = 'rejected'
      and reviewed_by is not null
      and reviewed_at is not null
      and length(btrim(rejection_reason)) between 1 and 500
    )
  )
);

create unique index teacher_applications_one_pending_per_user
  on app.teacher_applications (user_id)
  where status = 'pending';

create table app.staff_memberships (
  user_id uuid primary key references app.user_profiles(user_id),
  role app.staff_role not null,
  approved_by uuid references app.user_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_memberships_timestamps_ordered check (updated_at >= created_at)
);

create table app.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references app.user_profiles(user_id),
  action text not null,
  target_type text not null,
  target_id text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_details_is_object check (jsonb_typeof(details) = 'object')
);

do $role$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_backend') then
    create role app_backend
      nologin
      nosuperuser
      nocreatedb
      nocreaterole
      noinherit
      noreplication
      nobypassrls;
  end if;
end
$role$;

alter role app_backend
  nologin
  nocreatedb
  nocreaterole
  noinherit;

grant app_backend to postgres;

revoke all on schema app from public, anon, authenticated;
revoke all on all tables in schema app from public, anon, authenticated;
revoke all on all sequences in schema app from public, anon, authenticated;

grant usage on schema app to app_backend;
grant select, insert, update, delete
  on app.user_profiles,
     app.student_profiles,
     app.teacher_applications,
     app.staff_memberships
  to app_backend;
grant select, insert on app.audit_logs to app_backend;
grant usage, select on all sequences in schema app to app_backend;

alter table app.user_profiles enable row level security;
alter table app.student_profiles enable row level security;
alter table app.teacher_applications enable row level security;
alter table app.staff_memberships enable row level security;
alter table app.audit_logs enable row level security;

create policy user_profiles_app_backend_all
  on app.user_profiles
  for all
  to app_backend
  using (true)
  with check (true);

create policy student_profiles_app_backend_all
  on app.student_profiles
  for all
  to app_backend
  using (true)
  with check (true);

create policy teacher_applications_app_backend_all
  on app.teacher_applications
  for all
  to app_backend
  using (true)
  with check (true);

create policy staff_memberships_app_backend_all
  on app.staff_memberships
  for all
  to app_backend
  using (true)
  with check (true);

create policy audit_logs_app_backend_select
  on app.audit_logs
  for select
  to app_backend
  using (true);

create policy audit_logs_app_backend_insert
  on app.audit_logs
  for insert
  to app_backend
  with check (true);
