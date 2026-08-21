"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { formatDuration, formatSeoulTime } from "@/features/attendance/format";
import type { StudentStatistics } from "@/features/attendance/types";
import { EventOccurrences } from "@/features/events/event-card";
import { currentSeoulMonday } from "@/features/events/week-navigation";
import { api, ApiClientError } from "@/lib/api/client";

type Me = { onboarding_completed: boolean; capabilities: { student: boolean } };

export default function StudentPage() {
  const router = useRouter();
  const [statistics, setStatistics] = useState<StudentStatistics>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setError(undefined);
    setStatistics(undefined);
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    Promise.all([
      api.get<Me>("/api/me", { signal: controller.signal }),
      api.get<StudentStatistics>("/api/statistics/me", { signal: controller.signal }),
    ])
      .then(([me, nextStatistics]) => {
        if (!active) return;
        if (!me.onboarding_completed || !me.capabilities.student) {
          active = false;
          router.replace("/onboarding");
          return;
        }
        setStatistics(nextStatistics);
      })
      .catch((caught: unknown) => {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          active = false;
          router.replace("/auth/login");
          return;
        }
        if (caught instanceof ApiClientError && caught.code === "PROFILE_REQUIRED") {
          active = false;
          router.replace("/onboarding");
          return;
        }
        setError(caught instanceof ApiClientError ? caught.message : "학생 정보를 불러오지 못했습니다.");
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [attempt, router]);

  if (error) {
    return <main className="student-home-shell"><p role="alert">{error}</p><button type="button" className="primary-button" onClick={retry}>다시 시도</button></main>;
  }
  if (!statistics) return <main className="student-home-shell"><p role="status">학생 정보를 확인하고 있습니다.</p></main>;

  const openStay = statistics.currently_inside && statistics.open_stay_started_at
    ? `${formatSeoulTime(statistics.open_stay_started_at)}부터 머물고 있어요.`
    : "마지막 기록을 기준으로 안내합니다.";

  return (
    <main className="student-home-shell student-dashboard">
      <header className="student-dashboard__header">
        <p className="eyebrow">Student home</p>
        <h1>반가워요!</h1>
        <p>오늘도 안전하고 편안한 하루 보내세요.</p>
      </header>

      <section className="student-today-card" aria-labelledby="student-today-heading">
        <p className="eyebrow">Today</p>
        <h2 id="student-today-heading">오늘 출결 상태</h2>
        <strong>{statistics.currently_inside ? "현재 입실 중" : "퇴실 또는 출석 전"}</strong>
        <p>{openStay}</p>
      </section>

      <Link href="/student/scan" className="student-qr-action">QR로 출결하기</Link>

      <section className="student-month-card" aria-labelledby="student-month-heading">
        <div><p className="eyebrow">Monthly attendance</p><h2 id="student-month-heading">나의 이번 달</h2></div>
        <dl>
          <div><dt>출석일</dt><dd>이번 달 {statistics.attendance_days_this_month}일</dd></div>
          <div><dt>누적 입실</dt><dd>총 입실 {statistics.total_entries}회</dd></div>
          <div><dt>평균 체류</dt><dd>평균 체류 {formatDuration(statistics.average_stay_seconds)}</dd></div>
        </dl>
      </section>

      <section className="student-home-events" aria-labelledby="student-home-events-heading">
        <div className="student-home-events__heading">
          <div><p className="eyebrow">This week</p><h2 id="student-home-events-heading">이번 주 일정</h2></div>
          <Link href="/student/events">전체 일정</Link>
        </div>
        <EventOccurrences week={currentSeoulMonday()} limit={2} />
      </section>
    </main>
  );
}
