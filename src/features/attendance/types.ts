export type AttendanceDirection = "IN" | "OUT";
export type AttendanceSource = "QR" | "MANUAL";

export type AttendanceScan = {
  id: string;
  student_id: string;
  attendance_date: string;
  direction: AttendanceDirection;
  scanned_at: string;
  source: AttendanceSource;
  recorded_by: string | null;
  voided_at: string | null;
  voided_by: string | null;
  void_reason: string | null;
};

export type TeacherAttendanceItem = AttendanceScan & {
  student_name: string;
  student_email: string;
  excluded_from_statistics: boolean;
};

export type AttendanceHistoryPage<T extends AttendanceScan = AttendanceScan> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  timezone: "Asia/Seoul";
};

export type StudentStatistics = {
  attendance_days_this_week: number;
  attendance_days_this_month: number;
  total_entries: number;
  average_stay_seconds: number | null;
  currently_inside: boolean;
  open_stay_started_at: string | null;
  as_of_date: string;
  timezone: "Asia/Seoul";
};

export type TimeOfDayEntry = { hour: number; entries: number };

export type TeacherStatistics = {
  unique_students_today: number;
  unique_students_this_week: number;
  unique_students_this_month: number;
  currently_inside: number;
  average_stay_seconds: number | null;
  time_of_day_entries: TimeOfDayEntry[];
  student_attendance_days: Array<{
    student_id: string;
    student_name: string;
    attendance_days: number;
  }>;
  student_attendance_days_total: number;
  student_attendance_days_page: number;
  student_attendance_days_page_size: number;
  date_from: string;
  date_to: string;
  as_of_date: string;
  timezone: "Asia/Seoul";
};

export type TeacherDashboard = {
  today_attendees: number;
  currently_inside: number;
  week_attendees: number;
  statistics_target_students: number;
  recent_attendance: TeacherAttendanceItem[];
  as_of_date: string;
  timezone: "Asia/Seoul";
};

export type CurrentPresenceItem = {
  student_id: string;
  student_name: string;
  student_email: string;
  student_phone: string;
  guardian_phone: string;
  birth_date: string;
  checked_in_at: string;
  source: AttendanceSource;
  excluded_from_statistics: boolean;
};

export type CurrentPresencePage = {
  items: CurrentPresenceItem[];
  total: number;
  page: number;
  page_size: number;
  as_of_date: string;
  timezone: "Asia/Seoul";
};
