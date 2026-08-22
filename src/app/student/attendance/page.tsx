"use client";

import Link from "next/link";
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
  EmptyContent,
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
import { formatDuration, formatSeoulTime } from "@/features/attendance/format";
import { HistoryList } from "@/features/attendance/history-list";
import { SummaryCards } from "@/features/attendance/summary-cards";
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
          router.replace("/auth/login");
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
  const openDetail = summary.open_stay_started_at
    ? `${formatSeoulTime(summary.open_stay_started_at)}부터 머물고 있어요`
    : undefined;

  return (
    <main className="attendance-shell">
      <header className="attendance-page-header">
        <div>
          <p className="eyebrow">학생 출결</p>
          <h1>내 출결 기록</h1>
          <p>모든 시각은 한국 시간 기준으로 표시됩니다.</p>
        </div>
        <Button asChild size="lg"><Link href="/student/scan">QR 스캔하기</Link></Button>
      </header>

      <SummaryCards items={[
        { label: "이번 주", value: `이번 주 ${summary.attendance_days_this_week}일` },
        { label: "이번 달 출석 일수", value: `이번 달 ${summary.attendance_days_this_month}일` },
        { label: "누적 입실", value: `총 입실 ${summary.total_entries}회` },
        {
          label: "평균 체류",
          value: summary.average_stay_seconds === null
            ? "평균 체류 기록 없음"
            : `평균 체류 ${formatDuration(summary.average_stay_seconds)}`,
        },
        {
          label: "현재 상태",
          value: summary.currently_inside ? "현재 입실 중" : "현재 퇴실 상태",
          detail: openDetail,
          tone: summary.currently_inside ? "active" : "default",
        },
      ]} />

      <Card className="attendance-records-card" aria-label="최근 출결" role="region">
        <CardHeader className="attendance-section-heading">
          <div><p className="eyebrow">최근 기록</p><CardTitle><h2>입실·퇴실 내역</h2></CardTitle></div>
          <CardDescription>총 {history.total}건</CardDescription>
        </CardHeader>
        <CardContent className="attendance-records-content">
        {history.items.length === 0 ? (
          <Empty className="attendance-empty-state">
            <EmptyHeader><EmptyTitle>아직 출결 기록이 없어요.</EmptyTitle></EmptyHeader>
            <EmptyContent><Button asChild variant="outline"><Link href="/student/scan">첫 QR 스캔하기</Link></Button></EmptyContent>
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
