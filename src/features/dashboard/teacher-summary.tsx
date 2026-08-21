import Link from "next/link";

import { AttendanceTable } from "@/features/attendance/attendance-table";
import { HistoryList } from "@/features/attendance/history-list";
import { SummaryCards } from "@/features/attendance/summary-cards";
import type { TeacherDashboard } from "@/features/attendance/types";

export function TeacherSummary({ dashboard }: { dashboard: TeacherDashboard }) {
  return (
    <>
      <SummaryCards items={[
        { label: "오늘 출석", value: `오늘 출석 ${dashboard.today_attendees}명` },
        { label: "현재 입실", value: `현재 입실 ${dashboard.currently_inside}명`, tone: dashboard.currently_inside > 0 ? "active" : "default" },
        { label: "이번 주", value: `이번 주 ${dashboard.week_attendees}명` },
        { label: "통계 대상", value: `통계 대상 ${dashboard.statistics_target_students}명` },
      ]} />

      <nav className="dashboard-shortcuts" aria-label="출결 바로가기">
        <Link href="/teacher/attendance">전체 출결 보기</Link>
        <Link href="/teacher/attendance?status=IN">현재 상태 확인</Link>
        <Link href="/teacher/attendance?status=VOIDED">취소 기록 확인</Link>
      </nav>

      <section className="attendance-records-card" aria-labelledby="dashboard-recent-heading">
        <div className="attendance-section-heading">
          <div><p className="eyebrow">Recent attendance</p><h2 id="dashboard-recent-heading">최근 출결</h2></div>
          <span>한국 시간 기준</span>
        </div>
        {dashboard.recent_attendance.length === 0 ? (
          <div className="attendance-empty-state">아직 출결 기록이 없습니다.</div>
        ) : (
          <>
            <div className="attendance-mobile-only"><HistoryList scans={dashboard.recent_attendance} /></div>
            <div className="attendance-desktop-only"><AttendanceTable scans={dashboard.recent_attendance} /></div>
          </>
        )}
      </section>
    </>
  );
}
