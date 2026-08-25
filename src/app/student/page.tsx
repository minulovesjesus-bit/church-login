"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronRight,
  CircleAlert,
  Clock3,
  QrCode,
  UserRoundCheck,
} from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSeoulTime } from "@/features/attendance/format";
import { StudentMonthSummary } from "@/features/attendance/student-month-summary";
import type { StudentStatistics } from "@/features/attendance/types";
import { EventOccurrences } from "@/features/events/event-card";
import { currentSeoulMonday } from "@/features/events/week-navigation";
import { StudentAccountCard } from "@/features/student-account/student-account-card";
import { api, ApiClientError } from "@/lib/api/client";

type Me = {
  email: string;
  onboarding_completed: boolean;
  capabilities: { student: boolean; teacher: boolean; admin: boolean };
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function hasApiCode(error: unknown, code: string): boolean {
  return error instanceof ApiClientError && error.code === code;
}

export default function StudentPage() {
  const router = useRouter();
  const [identity, setIdentity] = useState<Me>();
  const [statistics, setStatistics] = useState<StudentStatistics>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setError(undefined);
    setIdentity(undefined);
    setStatistics(undefined);
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.allSettled([
      api.get<Me>("/api/me", { signal: controller.signal }),
      api.get<StudentStatistics>("/api/statistics/me", { signal: controller.signal }),
    ])
      .then(([meResult, statisticsResult]) => {
        if (!active) return;
        const failures = [meResult, statisticsResult]
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason as unknown);
        if (failures.some((failure) => hasApiCode(failure, "AUTH_REQUIRED"))) {
          active = false;
          router.replace("/login");
          return;
        }
        if (
          (meResult.status === "fulfilled"
            && (!meResult.value.onboarding_completed || !meResult.value.capabilities.student))
          || failures.some((failure) => hasApiCode(failure, "PROFILE_REQUIRED"))
        ) {
          active = false;
          router.replace("/onboarding");
          return;
        }
        if (failures.some(isAbortError)) return;
        const temporaryFailure = failures[0];
        if (temporaryFailure !== undefined) {
          setError(temporaryFailure instanceof ApiClientError
            ? temporaryFailure.message
            : "학생 정보를 불러오지 못했습니다.");
          return;
        }
        if (meResult.status === "fulfilled") setIdentity(meResult.value);
        if (statisticsResult.status === "fulfilled") setStatistics(statisticsResult.value);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, router]);

  if (error) {
    return (
      <main className="student-home-shell student-home-state">
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>학생 정보를 불러오지 못했습니다.</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button type="button" onClick={retry}>다시 시도</Button>
      </main>
    );
  }
  if (!identity || !statistics) {
    return (
      <main className="student-home-shell student-home-state" role="status">
        <span className="sr-only">학생 정보를 확인하고 있습니다.</span>
        <Skeleton className="h-8 w-2/5" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-16 w-full" />
      </main>
    );
  }

  const openStay = statistics.currently_inside && statistics.open_stay_started_at
    ? `${formatSeoulTime(statistics.open_stay_started_at)}부터 머물고 있어요.`
    : "마지막 기록을 기준으로 안내합니다.";

  return (
    <main className="student-home-shell student-dashboard">
      <section className="student-today" aria-labelledby="student-today-heading">
        <h2 id="student-today-heading">오늘 출결 상태</h2>
        <Card className="student-today-card">
          <CardHeader>
            <div className="student-today-card__icon" aria-hidden="true">
              <UserRoundCheck />
            </div>
            <CardTitle>
              <strong>{statistics.currently_inside ? "현재 입실 중" : "퇴실 또는 출석 전"}</strong>
            </CardTitle>
            <CardDescription className="student-today-card__detail">
              <Clock3 aria-hidden="true" /><span>{openStay}</span>
            </CardDescription>
          </CardHeader>
        </Card>
      </section>

      <Button asChild size="lg" className="student-qr-action">
        <Link href="/student/scan"><QrCode data-icon="inline-start" />QR로 출결하기</Link>
      </Button>

      <StudentMonthSummary statistics={statistics} />

      <section className="student-home-events" aria-labelledby="student-home-events-heading">
        <div className="student-home-events__heading">
          <h2 id="student-home-events-heading">이번 주 일정</h2>
          <Button asChild variant="ghost">
            <Link href="/student/events">전체 일정<ChevronRight data-icon="inline-end" /></Link>
          </Button>
        </div>
        <EventOccurrences week={currentSeoulMonday()} limit={2} />
      </section>
      <StudentAccountCard email={identity.email} />
    </main>
  );
}
