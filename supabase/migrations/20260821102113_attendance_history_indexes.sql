create index attendance_scans_teacher_history_idx
  on app.attendance_scans (attendance_date, scanned_at desc, id desc);

create index attendance_scans_teacher_statistics_idx
  on app.attendance_scans (attendance_date, student_id, scanned_at, id)
  where voided_at is null;
