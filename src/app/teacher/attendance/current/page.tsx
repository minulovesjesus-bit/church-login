"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDuration, formatSeoulTime } from "@/features/attendance/format";
import type { CurrentPresenceItem, CurrentPresencePage } from "@/features/attendance/types";
import { calculateInternationalAge } from "@/features/students/age";
import { api, ApiClientError } from "@/lib/api/client";

const PAGE_SIZE = 20;

type PresenceFilters = {
  query: string;
  page: number;
};

function filtersFromSearch(raw: string): PresenceFilters {
  const params = new URLSearchParams(raw);
  const query = (params.get("query") ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  const requestedPage = Number(params.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 10_000
    ? requestedPage
    : 1;
  return { query, page };
}

function pageUrl(filters: PresenceFilters): string {
  const params = new URLSearchParams();
  if (filters.query) params.set("query", filters.query);
  params.set("page", String(filters.page));
  return `/teacher/attendance/current?${params.toString()}`;
}

function apiPath(filters: PresenceFilters): `/api/${string}` {
  const params = new URLSearchParams();
  if (filters.query) params.set("query", filters.query);
  params.set("page", String(filters.page));
  params.set("page_size", String(PAGE_SIZE));
  return `/api/teacher/attendance/current?${params.toString()}`;
}

function stayDuration(checkedInAt: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(checkedInAt).getTime()) / 1000);
  return formatDuration(seconds);
}

function statusBadge(student: CurrentPresenceItem) {
  return (
    <Badge variant={student.excluded_from_statistics ? "outline" : "secondary"}>
      {student.excluded_from_statistics ? "통계 제외" : "통계 포함"}
    </Badge>
  );
}

function sourceLabel(student: CurrentPresenceItem): string {
  return student.source === "QR" ? "QR 출결" : "수동 기록";
}

function CurrentPresenceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const filters = useMemo(() => filtersFromSearch(searchKey), [searchKey]);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<CurrentPresencePage>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const requestKey = `${searchKey}:${attempt}`;

  useEffect(() => {
    let active = true;
    api.get<CurrentPresencePage>(apiPath(filters))
      .then((nextData) => {
        if (!active) return;
        setData(nextData);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/login");
          return;
        }
        if (caught instanceof ApiClientError && caught.code === "FORBIDDEN") {
          router.replace("/student");
          return;
        }
        setError({
          key: requestKey,
          message: caught instanceof ApiClientError
            ? caught.message
            : "현재 입실 학생을 불러오지 못했습니다.",
        });
      });
    return () => {
      active = false;
    };
  }, [attempt, filters, requestKey, router]);

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const query = String(form.get("query") ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    router.replace(pageUrl({ query, page: 1 }));
  }

  if (error?.key === requestKey) {
    return (
      <main className="attendance-shell attendance-shell--teacher current-presence-shell">
        <Alert className="attendance-error-card" variant="destructive">
          <AlertDescription>{error.message}</AlertDescription>
          <Button type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</Button>
        </Alert>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="attendance-shell attendance-shell--teacher current-presence-shell">
        <section className="attendance-loading-state" role="status">
          <p>현재 입실 학생을 불러오고 있어요.</p>
          <Skeleton className="h-24 w-full" aria-hidden="true" />
          <Skeleton className="h-64 w-full" aria-hidden="true" />
        </section>
      </main>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size));

  return (
    <main className="attendance-shell attendance-shell--teacher current-presence-shell">
      <header className="attendance-page-header">
        <div>
          <h1>현재 입실 상태</h1>
          <p>오늘 마지막 출결이 입실인 학생만 표시됩니다.</p>
        </div>
        <strong className="current-presence-count">현재 {data.total}명</strong>
      </header>

      <form key={searchKey} className="attendance-filter-card current-presence-search" role="search" onSubmit={submitSearch}>
        <Input
          name="query"
          type="search"
          maxLength={80}
          aria-label="현재 입실 학생 검색"
          placeholder="이름·이메일·연락처"
          defaultValue={filters.query}
        />
        <Button type="submit">검색</Button>
      </form>

      <section className="attendance-records-card current-presence-card" aria-labelledby="current-presence-list-heading">
        <div className="attendance-section-heading">
          <h2 id="current-presence-list-heading">입실 학생</h2>
          <span>이름순</span>
        </div>
        {data.items.length === 0 ? (
          <div className="attendance-empty-state">현재 입실 중인 학생이 없습니다.</div>
        ) : (
          <>
            <div className="attendance-desktop-only">
              <Table className="attendance-data-table current-presence-table" aria-label="현재 입실 학생 목록">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">이름</TableHead>
                    <TableHead scope="col">나이</TableHead>
                    <TableHead scope="col">학생 연락처</TableHead>
                    <TableHead scope="col">보호자 연락처</TableHead>
                    <TableHead scope="col">입실 시각</TableHead>
                    <TableHead scope="col">체류 시간</TableHead>
                    <TableHead scope="col">상태</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((student) => (
                    <TableRow key={student.student_id}>
                      <TableCell><strong>{student.student_name}</strong><span>{student.student_email}</span></TableCell>
                      <TableCell>만 {calculateInternationalAge(student.birth_date, data.as_of_date)}세</TableCell>
                      <TableCell>{student.student_phone}</TableCell>
                      <TableCell>{student.guardian_phone}</TableCell>
                      <TableCell>{formatSeoulTime(student.checked_in_at)}</TableCell>
                      <TableCell>{stayDuration(student.checked_in_at)}</TableCell>
                      <TableCell><div className="current-presence-badges"><Badge>{sourceLabel(student)}</Badge>{statusBadge(student)}</div></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="attendance-mobile-only current-presence-list" aria-label="모바일 현재 입실 학생 목록">
              {data.items.map((student) => (
                <li key={student.student_id}>
                  <Card>
                    <CardHeader>
                      <div>
                        <CardTitle><h3>{student.student_name}</h3></CardTitle>
                        <p>{student.student_email}</p>
                      </div>
                      <div className="current-presence-badges"><Badge>{sourceLabel(student)}</Badge>{statusBadge(student)}</div>
                    </CardHeader>
                    <CardContent>
                      <dl>
                        <div><dt>나이</dt><dd>만 {calculateInternationalAge(student.birth_date, data.as_of_date)}세</dd></div>
                        <div><dt>학생 연락처</dt><dd>{student.student_phone}</dd></div>
                        <div><dt>보호자 연락처</dt><dd>{student.guardian_phone}</dd></div>
                        <div><dt>입실 시각</dt><dd>{formatSeoulTime(student.checked_in_at)}</dd></div>
                        <div><dt>체류 시간</dt><dd>{stayDuration(student.checked_in_at)}</dd></div>
                      </dl>
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}

        <Pagination className="attendance-pagination" aria-label="현재 입실 학생 페이지">
          <PaginationContent>
            <PaginationItem>
              <Button
                type="button"
                variant="outline"
                disabled={data.page <= 1}
                onClick={() => router.replace(pageUrl({ ...filters, page: Math.max(1, data.page - 1) }))}
              >
                이전 페이지
              </Button>
            </PaginationItem>
            <PaginationItem><span>{data.page} / {totalPages} 페이지 · 총 {data.total}명</span></PaginationItem>
            <PaginationItem>
              <Button
                type="button"
                variant="outline"
                disabled={data.page >= totalPages}
                onClick={() => router.replace(pageUrl({ ...filters, page: Math.min(totalPages, data.page + 1) }))}
              >
                다음 페이지
              </Button>
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      </section>
    </main>
  );
}

export default function CurrentPresencePage() {
  return (
    <Suspense fallback={<main className="attendance-shell"><p role="status">현재 입실 학생을 준비하고 있어요.</p></main>}>
      <CurrentPresenceContent />
    </Suspense>
  );
}
