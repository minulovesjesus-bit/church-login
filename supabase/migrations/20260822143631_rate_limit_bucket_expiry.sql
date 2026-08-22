alter table app.rate_limit_buckets
  add column expires_at timestamptz;

update app.rate_limit_buckets
set expires_at = greatest(
  window_started_at + interval '5 minutes',
  coalesce(blocked_until, window_started_at + interval '5 minutes')
);

alter table app.rate_limit_buckets
  alter column expires_at set not null;

create index rate_limit_buckets_action_expires_at_idx
  on app.rate_limit_buckets (action, expires_at, bucket_key_hash);
