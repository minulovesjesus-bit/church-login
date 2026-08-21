create table app.events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  repeat_weekly boolean not null default false,
  repeat_until date,
  created_by uuid not null references app.staff_memberships(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_title_length check (
    length(btrim(title)) between 1 and 120
  ),
  constraint events_description_length check (
    description is null
    or length(btrim(description)) between 1 and 2000
  ),
  constraint events_location_length check (
    location is null
    or length(btrim(location)) between 1 and 200
  ),
  constraint events_positive_duration check (ends_at > starts_at),
  constraint events_duration_bounded check (
    ends_at <= starts_at + interval '7 days'
  ),
  constraint events_repeat_until_weekly check (
    repeat_weekly or repeat_until is null
  )
);

create index events_created_by_idx on app.events (created_by);
create index events_starts_at_idx on app.events (starts_at);
create index events_one_time_ends_at_idx
  on app.events (ends_at)
  where not repeat_weekly;
create index events_weekly_repeat_until_idx
  on app.events (repeat_until)
  where repeat_weekly;

revoke all on app.events from public, anon, authenticated;
grant select, insert, update, delete on app.events to app_backend;

alter table app.events enable row level security;

create policy events_app_backend_all
  on app.events
  for all
  to app_backend
  using (true)
  with check (true);
