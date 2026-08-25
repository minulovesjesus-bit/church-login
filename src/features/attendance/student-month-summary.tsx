import { CalendarCheck2, Clock3, LogIn } from "lucide-react";

import { formatDuration } from "@/features/attendance/format";
import type { StudentStatistics } from "@/features/attendance/types";

type StudentMonthSummaryProps = {
  statistics: StudentStatistics;
  showHeading?: boolean;
};

export function StudentMonthSummary({ statistics, showHeading = true }: StudentMonthSummaryProps) {
  return (
    <section
      className="student-month"
      aria-labelledby={showHeading ? "student-month-heading" : undefined}
    >
      {showHeading ? <h2 id="student-month-heading">나의 이번 달</h2> : null}
      <dl className="student-month-rail" aria-label="나의 이번 달 출결 통계">
        <div>
          <CalendarCheck2 aria-hidden="true" />
          <dt>출석일</dt>
          <dd>이번 달 {statistics.attendance_days_this_month}일</dd>
        </div>
        <div>
          <LogIn aria-hidden="true" />
          <dt>누적 입실</dt>
          <dd>총 입실 {statistics.total_entries}회</dd>
        </div>
        <div>
          <Clock3 aria-hidden="true" />
          <dt>평균 체류</dt>
          <dd>평균 체류 {formatDuration(statistics.average_stay_seconds)}</dd>
        </div>
      </dl>
    </section>
  );
}
