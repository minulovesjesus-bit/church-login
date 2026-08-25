"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { AttendanceTable } from "@/features/attendance/attendance-table";
import { HistoryList } from "@/features/attendance/history-list";
import { StudentMonthSummary } from "@/features/attendance/student-month-summary";
import type {
  AttendanceHistoryPage,
  AttendanceScan,
  StudentStatistics,
} from "@/features/attendance/types";
import { api, ApiClientError } from "@/lib/api/client";

const PAGE_SIZE = 20;

export default function StudentAttendancePage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<AttendanceHistoryPage<AttendanceScan>>();
  const [summary, setSummary] = useState<StudentStatistics>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const requestKey = `${page}:${attempt}`;

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<AttendanceHistoryPage<AttendanceScan>>(`/api/attendance/me?page=${page}&page_size=${PAGE_SIZE}`),
      api.get<StudentStatistics>("/api/statistics/me"),
    ])
      .then(([nextHistory, nextSummary]) => {
        if (!active) return;
        setHistory(nextHistory);
        setSummary(nextSummary);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/login");
          return;
        }
        if (caught instanceof ApiClientError && caught.code === "PROFILE_REQUIRED") {
          router.replace("/onboarding");
          return;
        }
        setError({
          key: requestKey,
          message: caught instanceof ApiClientError ? caught.message : "출결 기록을 불러오지 못했습니다.",
        });
      });
    return () => {
      active = false;
    };
  }, [attempt, page, requestKey, router]);

  if (error?.key === requestKey) {
    return (
      <main className="attendance-shell">
        <Alert className="attendance-error-card" variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
          <Button type="button" onClick={() => setAttempt((value) => value + 1)}>
            다시 시도
          </Button>
        </Alert>
      </main>
    );
  }

  if (!history || !summary) {
    return (
      <main className="attendance-shell">
        <section className="attendance-loading-state" role="status">
          <p>출결 기록을 불러오고 있어요.</p>
          <div aria-hidden="true" className="attendance-loading-state__rail">
            {Array.from({ length: 5 }, (_, index) => <Skeleton className="h-20" key={index} />)}
          </div>
          <Skeleton aria-hidden="true" className="h-64 w-full" />
        </section>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(history.total / history.page_size));

  return (
    <main className="attendance-shell">
      <header className="attendance-page-header">
        <div>
          <h1>내 출결 기록</h1>
        </div>
      </header>

      <StudentMonthSummary statistics={summary} showHeading={false} />

      <Card className="attendance-records-card" aria-label="최근 출결" role="region">
        <CardHeader className="attendance-section-heading">
          <div><p className="eyebrow">최근 기록</p><CardTitle><h2>입실·퇴실 내역</h2></CardTitle></div>
          <CardDescription>총 {history.total}건</CardDescription>
        </CardHeader>
        <CardContent className="attendance-records-content">
        {history.items.length === 0 ? (
          <Empty className="attendance-empty-state">
            <EmptyHeader><EmptyTitle>아직 출결 기록이 없어요.</EmptyTitle></EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="attendance-mobile-only"><HistoryList scans={history.items} /></div>
            <div className="attendance-desktop-only"><AttendanceTable scans={history.items} /></div>
          </>
        )}
        </CardContent>
        <CardFooter>
          <Pagination className="attendance-pagination" aria-label="개인 출결 페이지">
            <PaginationContent>
              <PaginationItem>
                <Button type="button" variant="outline" disabled={history.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                  <ChevronLeftIcon data-icon="inline-start" />이전 페이지
                </Button>
              </PaginationItem>
              <PaginationItem><span>{history.page} / {totalPages} 페이지</span></PaginationItem>
              <PaginationItem>
                <Button type="button" variant="outline" disabled={history.page >= totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>
                  다음 페이지<ChevronRightIcon data-icon="inline-end" />
                </Button>
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </CardFooter>
      </Card>
    </main>
  );
}
