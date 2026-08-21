create index kiosk_sessions_admin_created_at_id_idx
  on app.kiosk_sessions (created_at desc, id desc);
