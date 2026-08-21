create index attendance_scans_recent_idx
  on app.attendance_scans (scanned_at desc, id desc);
