import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { AttendanceTable } from "@/features/attendance/attendance-table";
import { HistoryList } from "@/features/attendance/history-list";
import type { TeacherDashboard } from "@/features/attendance/types";

export function TeacherSummary({ dashboard }: { dashboard: TeacherDashboard }) {
  const metrics = [
    { label: "오늘 출석", value: dashboard.today_attendees },
    { label: "현재 입실", value: dashboard.currently_inside },
    { label: "이번 주", value: dashboard.week_attendees },
    { label: "통계 대상", value: dashboard.statistics_target_students },
  ] as const;

  return (
    <>
      <Card className="teacher-metric-rail">
        <CardHeader className="sr-only">
          <CardTitle>출결 요약</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="teacher-metric-list" aria-label="출결 요약">
            {metrics.map((metric) => (
              <div key={metric.label}>
                <dt>{metric.label}</dt>
                <dd>
                  <strong>{metric.value}</strong>
                  <span>명</span>
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      <nav className="dashboard-shortcuts" aria-label="출결 바로가기">
        <Button variant="outline" asChild><Link href="/teacher/attendance">전체 출결 보기</Link></Button>
        <Button variant="outline" asChild><Link href="/teacher/attendance/current">현재 입실 상태</Link></Button>
        <Button variant="outline" asChild><Link href="/teacher/attendance?status=VOIDED">취소 기록 확인</Link></Button>
      </nav>

      <Card className="teacher-recent-card">
        <CardHeader>
          <CardTitle id="dashboard-recent-heading">최근 출결</CardTitle>
          <CardDescription>한국 시간 기준</CardDescription>
        </CardHeader>
        <CardContent>
          {dashboard.recent_attendance.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>아직 출결 기록이 없습니다.</EmptyTitle>
                <EmptyDescription>출결 기록이 생성되면 이곳에 최근 순서로 표시됩니다.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <div className="attendance-mobile-only"><HistoryList scans={dashboard.recent_attendance} /></div>
              <div className="attendance-desktop-only"><AttendanceTable scans={dashboard.recent_attendance} /></div>
            </>
          )}
        </CardContent>
      </Card>
    </>
  );
}
