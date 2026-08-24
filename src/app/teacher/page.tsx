"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
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
  const redirectToLogin = useCallback(() => router.replace("/login"), [router]);
  const redirectToStudent = useCallback(() => router.replace("/student"), [router]);
  const { data, error, isLoading, isStale, retry } = useDashboardPolling({
    fetcher: fetchDashboard,
    onAuthRequired: redirectToLogin,
    onForbidden: redirectToStudent,
  });

  if (isLoading && !data) {
    return (
      <main className="teacher-dashboard-shell">
        <div className="teacher-dashboard-loading">
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-32 w-full" />
          <p role="status">대시보드를 불러오고 있습니다.</p>
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="teacher-dashboard-shell">
        {error ? (
          <Alert className="teacher-dashboard-error" variant="destructive">
            <AlertTitle>대시보드를 불러오지 못했습니다.</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
            <Button type="button" onClick={retry}>다시 시도</Button>
          </Alert>
        ) : <p role="status">교사 페이지로 이동하고 있습니다.</p>}
      </main>
    );
  }

  return (
    <main className="teacher-dashboard-shell">
      <header className="attendance-page-header">
        <div><h1>교사 대시보드</h1><p>{data.as_of_date} · 모든 시각은 한국 시간 기준입니다.</p></div>
      </header>
      {isStale ? (
        <Alert className="dashboard-stale-notice" role="alert">
          <div>
            <AlertTitle>마지막으로 확인된 정보입니다.</AlertTitle>
            <AlertDescription>최근 새로고침에 실패해 마지막으로 확인된 정보를 표시합니다.</AlertDescription>
          </div>
          <Button type="button" variant="outline" onClick={retry}>지금 다시 시도</Button>
        </Alert>
      ) : null}
      <TeacherSummary dashboard={data} />
    </main>
  );
}
