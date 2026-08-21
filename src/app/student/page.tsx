"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { EventOccurrences } from "@/features/events/event-card";
import { currentSeoulMonday } from "@/features/events/week-navigation";
import { api, ApiClientError } from "@/lib/api/client";

type Me = { onboarding_completed: boolean; capabilities: { student: boolean } };

export default function StudentPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  function retry() {
    setError(undefined);
    setReady(false);
    setAttempt((value) => value + 1);
  }

  useEffect(() => {
    let active = true;
    api.get<Me>("/api/me")
      .then((me) => {
        if (!active) return;
        if (!me.onboarding_completed || !me.capabilities.student) router.replace("/onboarding");
        else setReady(true);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        if (caught instanceof ApiClientError && caught.code === "AUTH_REQUIRED") {
          router.replace("/auth/login");
          return;
        }
        setError(caught instanceof ApiClientError ? caught.message : "학생 정보를 불러오지 못했습니다.");
      });
    return () => {
      active = false;
    };
  }, [attempt, router]);

  if (error) {
    return <main className="student-home-shell"><p role="alert">{error}</p><button type="button" onClick={retry}>다시 시도</button></main>;
  }
  if (!ready) return <main className="student-home-shell">학생 정보를 확인하고 있습니다.</main>;
  return (
    <main className="student-home-shell">
      <h1>학생 출결</h1>
      <p>오늘의 출결과 QR 스캔 기능을 이용할 수 있습니다.</p>
      <section className="student-home-events" aria-labelledby="student-home-events-heading">
        <div className="student-home-events__heading">
          <h2 id="student-home-events-heading">이번 주 일정</h2>
        </div>
        <EventOccurrences week={currentSeoulMonday()} limit={2} />
      </section>
    </main>
  );
}
