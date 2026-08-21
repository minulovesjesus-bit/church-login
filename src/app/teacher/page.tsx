"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import type { TeacherDashboard } from "@/features/attendance/types";
import { TeacherSummary } from "@/features/dashboard/teacher-summary";
import { useDashboardPolling } from "@/features/dashboard/use-dashboard-polling";
import { api } from "@/lib/api/client";

export default function TeacherPage() {
  const router = useRouter();
  const fetchDashboard = useCallback(
    (signal: AbortSignal) => api.get<TeacherDashboard>("/api/teacher/dashboard", { signal }),
    [],
  );
  const redirectToLogin = useCallback(() => router.replace("/teacher/login"), [router]);
  const redirectToApply = useCallback(() => router.replace("/teacher/apply"), [router]);
  const { data, error, isLoading, isStale, retry } = useDashboardPolling({
    fetcher: fetchDashboard,
    onAuthRequired: redirectToLogin,
    onForbidden: redirectToApply,
  });

  if (isLoading && !data) {
    return <main className="teacher-dashboard-shell"><p role="status">대시보드를 불러오고 있습니다.</p></main>;
  }
  if (!data) {
    return (
      <main className="teacher-dashboard-shell">
        {error ? <section className="attendance-error-card"><p role="alert">{error}</p><button type="button" className="primary-button" onClick={retry}>다시 시도</button></section> : <p role="status">교사 페이지로 이동하고 있습니다.</p>}
      </main>
    );
  }

  return (
    <main className="teacher-dashboard-shell">
      <header className="attendance-page-header">
        <div><p className="eyebrow">Attendance overview</p><h1>교사 대시보드</h1><p>{data.as_of_date} · 모든 시각은 한국 시간 기준입니다.</p></div>
      </header>
      {isStale ? <div className="dashboard-stale-notice" role="alert"><p>최근 새로고침에 실패해 마지막으로 확인된 정보를 표시합니다.</p><button type="button" className="secondary-button" onClick={retry}>지금 다시 시도</button></div> : null}
      <TeacherSummary dashboard={data} />
    </main>
  );
}
