"use client";

import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { AttendanceTable } from "@/features/attendance/attendance-table";
import { formatDuration, formatSeoulDateTime, seoulLocalInputToIso } from "@/features/attendance/format";
import { HistoryList, RecordBadges } from "@/features/attendance/history-list";
import { SummaryCards } from "@/features/attendance/summary-cards";
import type {
  AttendanceDirection,
  AttendanceHistoryPage,
  AttendanceScan,
  TeacherAttendanceItem,
  TeacherStatistics,
} from "@/features/attendance/types";
import { api, ApiClientError } from "@/lib/api/client";

const StayChart = dynamic(() => import("@/features/attendance/stay-chart"), {
  ssr: false,
  loading: () => <p role="status">차트를 준비하고 있어요.</p>,
});

const PAGE_SIZE = 20;
const STATUS_VALUES = new Set(["ALL", "IN", "OUT", "VOIDED"]);
type AttendanceStatus = "ALL" | "IN" | "OUT" | "VOIDED";

type Filters = {
  dateFrom: string;
  dateTo: string;
  status: AttendanceStatus;
  search: string;
  page: number;
};

function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function validDate(value: string | null): value is string {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  if (Number(match[1]) < 1) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.getUTCFullYear() === Number(match[1])
    && parsed.getUTCMonth() + 1 === Number(match[2])
    && parsed.getUTCDate() === Number(match[3]);
}

function filtersFromSearch(raw: string): Filters {
  const params = new URLSearchParams(raw);
  const defaultTo = seoulToday();
  const requestedFrom = params.get("date_from");
  const requestedTo = params.get("date_to");
  let dateTo = validDate(requestedTo) ? requestedTo : defaultTo;
  let dateFrom = validDate(requestedFrom) ? requestedFrom : addDays(dateTo, -29);
  const span = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000;
  if (span < 0 || span > 365) {
    dateTo = defaultTo;
    dateFrom = addDays(dateTo, -29);
  }
  const rawStatus = params.get("status") ?? "ALL";
  const status = (STATUS_VALUES.has(rawStatus) ? rawStatus : "ALL") as AttendanceStatus;
  const search = (params.get("search") ?? "").trim().slice(0, 80);
  const rawPage = Number(params.get("page") ?? "1");
  const page = Number.isInteger(rawPage) && rawPage >= 1 && rawPage <= 10_000 ? rawPage : 1;
  return { dateFrom, dateTo, status, search, page };
}

function filterUrl(filters: Filters): string {
  const params = new URLSearchParams({
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    status: filters.status,
    page: String(filters.page),
  });
  if (filters.search) params.set("search", filters.search.trim().slice(0, 80));
  return `/teacher/attendance?${params.toString()}`;
}

function historyPath(filters: Filters): `/api/${string}` {
  return `/api/teacher/attendance?${filterUrl(filters).split("?")[1]}&page_size=${PAGE_SIZE}`;
}

function statisticsPath(filters: Filters): `/api/${string}` {
  const params = new URLSearchParams({
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    page: "1",
    page_size: String(PAGE_SIZE),
  });
  if (filters.search) params.set("search", filters.search);
  return `/api/teacher/statistics?${params.toString()}`;
}

function TeacherAttendanceContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchKey = searchParams.toString();
  const filters = useMemo(() => filtersFromSearch(searchKey), [searchKey]);
  const [attempt, setAttempt] = useState(0);
  const [history, setHistory] = useState<AttendanceHistoryPage<TeacherAttendanceItem>>();
  const [statistics, setStatistics] = useState<TeacherStatistics>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const [selected, setSelected] = useState<TeacherAttendanceItem>();
  const [reason, setReason] = useState("");
  const [manualDirection, setManualDirection] = useState<AttendanceDirection>("IN");
  const [manualTime, setManualTime] = useState("");
  const [correctionError, setCorrectionError] = useState<string>();
  const [correctionNotice, setCorrectionNotice] = useState<string>();
  const [saving, setSaving] = useState(false);
  const correctionOpenerRef = useRef<HTMLButtonElement | null>(null);
  const correctionCloseRef = useRef<HTMLButtonElement | null>(null);

  const requestKey = `${searchKey}:${attempt}`;

  useEffect(() => {
    let active = true;
    Promise.all([
      api.get<AttendanceHistoryPage<TeacherAttendanceItem>>(historyPath(filters)),
      api.get<TeacherStatistics>(statisticsPath(filters)),
    ])
      .then(([nextHistory, nextStatistics]) => {
        if (!active) return;
        setHistory(nextHistory);
        setStatistics(nextStatistics);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/teacher/login");
          return;
        }
        if (caught instanceof ApiClientError && caught.code === "FORBIDDEN") {
          router.replace("/teacher/apply");
          return;
        }
        setError({
          key: requestKey,
          message: caught instanceof ApiClientError ? caught.message : "전체 출결을 불러오지 못했습니다.",
        });
      });
    return () => {
      active = false;
    };
  }, [attempt, filters, requestKey, router]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const normalized = filtersFromSearch(new URLSearchParams({
      date_from: String(formData.get("date_from") ?? ""),
      date_to: String(formData.get("date_to") ?? ""),
      status: String(formData.get("status") ?? "ALL"),
      search: String(formData.get("search") ?? "").trim(),
      page: "1",
    }).toString());
    router.replace(filterUrl(normalized));
  }

  function selectRecord(scan: TeacherAttendanceItem, opener: HTMLButtonElement) {
    correctionOpenerRef.current = opener;
    setSelected(scan);
    setReason("");
    setManualDirection(scan.direction === "IN" ? "OUT" : "IN");
    setManualTime("");
    setCorrectionError(undefined);
    setCorrectionNotice(undefined);
  }

  async function submitCorrection(mode: "VOID" | "MANUAL") {
    if (!selected || saving) return;
    const normalizedReason = reason.trim();
    if (!normalizedReason) {
      setCorrectionError("보정 사유를 입력해 주세요.");
      return;
    }
    let body: Record<string, string>;
    if (mode === "VOID") {
      body = { mode, scan_id: selected.id, reason: normalizedReason };
    } else {
      const scannedAt = seoulLocalInputToIso(manualTime);
      if (!scannedAt) {
        setCorrectionError("수동 출결 시각을 정확히 입력해 주세요.");
        return;
      }
      body = {
        mode,
        student_id: selected.student_id,
        direction: manualDirection,
        scanned_at: scannedAt,
        reason: normalizedReason,
      };
    }
    setSaving(true);
    setCorrectionError(undefined);
    setCorrectionNotice(undefined);
    try {
      const corrected = await api.post<AttendanceScan>(
        "/api/teacher/attendance/corrections",
        body,
      );
      if (mode === "VOID") {
        setSelected((current) => (
          current?.id === corrected.id ? { ...current, ...corrected } : current
        ));
      }
      setCorrectionNotice("보정이 저장되었습니다. 원본 기록과 감사 이력은 그대로 유지됩니다.");
      setAttempt((value) => value + 1);
    } catch (caught) {
      setCorrectionError(caught instanceof ApiClientError ? caught.message : "보정을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  if (error?.key === requestKey) {
    return (
      <main className="attendance-shell"><Alert className="attendance-error-card" variant="destructive">
        <AlertDescription>{error.message}</AlertDescription>
        <Button type="button" onClick={() => setAttempt((value) => value + 1)}>다시 시도</Button>
      </Alert></main>
    );
  }
  if (!history || !statistics) {
    return <main className="attendance-shell"><div className="attendance-loading-state">
      <p role="status">전체 출결을 불러오고 있어요.</p>
      <div className="attendance-loading-state__rail" aria-hidden="true">
        <Skeleton className="h-20" /><Skeleton className="h-20" /><Skeleton className="h-20" />
      </div>
      <Skeleton className="h-64" aria-hidden="true" />
    </div></main>;
  }

  const totalPages = Math.max(1, Math.ceil(history.total / history.page_size));
  return (
    <main className="attendance-shell attendance-shell--teacher">
      <header className="attendance-page-header">
        <div><h1>전체 출결 관리</h1><p>조회·통계·보정 시각은 모두 한국 시간 기준입니다.</p></div>
      </header>

      <form key={searchKey} className="attendance-filter-card" aria-label="출결 필터" onSubmit={applyFilters}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="attendance-date-from">시작일</FieldLabel>
            <Input id="attendance-date-from" name="date_from" type="date" defaultValue={filters.dateFrom} />
          </Field>
          <Field>
            <FieldLabel htmlFor="attendance-date-to">종료일</FieldLabel>
            <Input id="attendance-date-to" name="date_to" type="date" defaultValue={filters.dateTo} />
          </Field>
          <Field>
            <FieldLabel id="attendance-status-label" htmlFor="attendance-status">출결 상태</FieldLabel>
            <Select name="status" defaultValue={filters.status}>
              <SelectTrigger id="attendance-status" aria-labelledby="attendance-status-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>출결 상태</SelectLabel>
                  <SelectItem value="ALL">전체</SelectItem>
                  <SelectItem value="IN">입실</SelectItem>
                  <SelectItem value="OUT">퇴실</SelectItem>
                  <SelectItem value="VOIDED">취소 기록</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field className="attendance-filter-card__search">
            <FieldLabel htmlFor="attendance-search">학생 검색</FieldLabel>
            <Input id="attendance-search" name="search" type="search" maxLength={80} placeholder="이름·이메일·연락처" defaultValue={filters.search} />
          </Field>
          <Button type="submit">필터 적용</Button>
        </FieldGroup>
      </form>

      <SummaryCards items={[
        { label: "오늘 출석", value: `오늘 ${statistics.unique_students_today}명` },
        { label: "이번 주", value: `이번 주 ${statistics.unique_students_this_week}명` },
        { label: "이번 달", value: `이번 달 ${statistics.unique_students_this_month}명` },
        { label: "현재 상태", value: `현재 입실 ${statistics.currently_inside}명`, tone: statistics.currently_inside > 0 ? "active" : "default" },
        { label: "평균 체류", value: `평균 ${formatDuration(statistics.average_stay_seconds)}` },
      ]} />

      <section className="attendance-records-card attendance-chart-card" aria-labelledby="entry-chart-title">
        <div className="attendance-section-heading"><h2 id="entry-chart-title">시간대별 입실</h2></div>
        <StayChart entries={statistics.time_of_day_entries} />
        <Table className="attendance-data-table" aria-label="시간대별 입실 데이터">
          <TableHeader><TableRow><TableHead scope="col">시간대</TableHead><TableHead scope="col">입실 횟수</TableHead></TableRow></TableHeader>
          <TableBody>{statistics.time_of_day_entries.map((entry) => <TableRow key={entry.hour}><TableCell>{entry.hour}시</TableCell><TableCell>{entry.entries}회</TableCell></TableRow>)}</TableBody>
        </Table>
      </section>

      <section className="attendance-records-card" aria-label="전체 출결 목록">
        <div className="attendance-section-heading"><h2>학생별 입실·퇴실</h2><span>총 {history.total}건</span></div>
        {history.items.length === 0 ? <div className="attendance-empty-state">조건에 맞는 출결 기록이 없어요.</div> : (
          <><div className="attendance-mobile-only"><HistoryList scans={history.items} onSelect={selectRecord} /></div><div className="attendance-desktop-only"><AttendanceTable scans={history.items} onSelect={selectRecord} /></div></>
        )}
        <Pagination className="attendance-pagination" aria-label="전체 출결 페이지">
          <PaginationContent>
            <PaginationItem><Button type="button" variant="outline" disabled={history.page <= 1} onClick={() => router.replace(filterUrl({ ...filters, page: Math.max(1, filters.page - 1) }))}>이전 페이지</Button></PaginationItem>
            <PaginationItem><span>{history.page} / {totalPages} 페이지 · 총 {history.total}건</span></PaginationItem>
            <PaginationItem><Button type="button" variant="outline" disabled={history.page >= totalPages} onClick={() => router.replace(filterUrl({ ...filters, page: Math.min(totalPages, filters.page + 1) }))}>다음 페이지</Button></PaginationItem>
          </PaginationContent>
        </Pagination>
      </section>

      <Sheet open={Boolean(selected)} onOpenChange={(open) => {
        if (!open) setSelected(undefined);
      }}>
        {selected ? (
          <SheetContent
            className="attendance-correction-sheet sm:max-w-md"
            showCloseButton={false}
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              correctionCloseRef.current?.focus();
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              correctionOpenerRef.current?.focus();
            }}
          >
            <SheetHeader className="attendance-correction-sheet__header">
              <div>
                <SheetTitle>{selected.student_name} 출결 상세 및 보정</SheetTitle>
                <SheetDescription>{selected.student_email}</SheetDescription>
              </div>
              <SheetClose asChild>
                <Button ref={correctionCloseRef} type="button" variant="ghost">닫기</Button>
              </SheetClose>
            </SheetHeader>
            <div className="attendance-correction-sheet__content">
              <p><strong>{selected.direction === "IN" ? "입실" : "퇴실"}</strong> · {formatSeoulDateTime(selected.scanned_at)}</p>
              <RecordBadges scan={selected} />
              {selected.void_reason ? <p className="attendance-void-reason">취소 사유: {selected.void_reason}</p> : null}
              <Separator />
              <Field data-invalid={Boolean(correctionError && !reason.trim())}>
                <FieldLabel htmlFor="attendance-correction-reason">보정 사유</FieldLabel>
                <Textarea id="attendance-correction-reason" value={reason} maxLength={500} required aria-invalid={Boolean(correctionError && !reason.trim())} onChange={(event) => setReason(event.target.value)} placeholder="변경 이유를 구체적으로 입력해 주세요." />
              </Field>
              {correctionError ? <Alert variant="destructive"><AlertDescription>{correctionError}</AlertDescription></Alert> : null}
              {correctionNotice ? <Alert role="status"><AlertDescription>{correctionNotice}</AlertDescription></Alert> : null}
              <Button type="button" variant="outline" disabled={saving || Boolean(selected.voided_at)} onClick={() => void submitCorrection("VOID")}>{saving ? "저장 중…" : "원본 기록 취소"}</Button>
              <Separator />
              <section className="attendance-manual-form" aria-labelledby="attendance-manual-title">
                <h3 id="attendance-manual-title">수동 기록 추가</h3>
                <FieldGroup>
                  <Field>
                    <FieldLabel id="attendance-manual-direction-label" htmlFor="attendance-manual-direction">수동 출결 방향</FieldLabel>
                    <Select value={manualDirection} onValueChange={(value) => setManualDirection(value as AttendanceDirection)}>
                      <SelectTrigger id="attendance-manual-direction" aria-labelledby="attendance-manual-direction-label"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectLabel>수동 출결 방향</SelectLabel>
                          <SelectItem value="IN">입실</SelectItem>
                          <SelectItem value="OUT">퇴실</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="attendance-manual-time">수동 출결 시각</FieldLabel>
                    <Input id="attendance-manual-time" type="datetime-local" value={manualTime} onChange={(event) => setManualTime(event.target.value)} />
                  </Field>
                  <Button type="button" disabled={saving} onClick={() => void submitCorrection("MANUAL")}>{saving ? "저장 중…" : "수동 기록 추가"}</Button>
                </FieldGroup>
              </section>
            </div>
          </SheetContent>
        ) : null}
      </Sheet>
    </main>
  );
}

export default function TeacherAttendancePage() {
  return (
    <Suspense fallback={<main className="attendance-shell"><div className="attendance-loading-state"><p role="status">전체 출결을 준비하고 있어요.</p><Skeleton className="h-64" aria-hidden="true" /></div></main>}>
      <TeacherAttendanceContent />
    </Suspense>
  );
}
