alter table app.kiosk_sessions
  add column device_name text;

update app.kiosk_sessions
set device_name = '기존 키오스크 ' || left(id::text, 8)
where device_name is null;

alter table app.kiosk_sessions
  alter column device_name set not null,
  add constraint kiosk_sessions_device_name_valid check (
    device_name = btrim(device_name)
    and length(device_name) between 1 and 80
  );

alter table app.attendance_scans
  add column kiosk_device_name text;

update app.attendance_scans scan
set kiosk_device_name = session.device_name
from app.kiosk_sessions session
where scan.kiosk_session_id = session.id
  and scan.source = 'QR';

alter table app.attendance_scans
  drop constraint attendance_scans_kiosk_session_id_fkey,
  add constraint attendance_scans_kiosk_session_id_fkey
    foreign key (kiosk_session_id)
    references app.kiosk_sessions(id)
    on delete set null;

alter table app.attendance_scans
  drop constraint attendance_scans_source_fields_consistent,
  add constraint attendance_scans_source_fields_consistent check (
    (
      source <> 'QR'
      or (qr_issued_at is not null and kiosk_device_name is not null)
    )
    and (source <> 'MANUAL' or recorded_by is not null)
  ),
  add constraint attendance_scans_kiosk_device_name_valid check (
    kiosk_device_name is null
    or (
      kiosk_device_name = btrim(kiosk_device_name)
      and length(kiosk_device_name) between 1 and 80
    )
  );
