"use client";

import { use } from "react";

import { EventOccurrences } from "@/features/events/event-card";
import { resolveSeoulMonday, WeekNavigation, type WeekSearchValue } from "@/features/events/week-navigation";

type StudentEventsPageProps = {
  searchParams: Promise<{ week?: WeekSearchValue }>;
};

export default function StudentEventsPage({ searchParams }: StudentEventsPageProps) {
  const { week } = use(searchParams);
  const selectedWeek = resolveSeoulMonday(week);

  return (
    <main className="events-shell">
      <header className="events-page-header">
        <div>
          <h1>주간 일정</h1>
          <p>서울 시간을 기준으로 이번 주 교회 일정을 확인하세요.</p>
        </div>
        <WeekNavigation week={selectedWeek} />
      </header>
      <EventOccurrences week={selectedWeek} />
    </main>
  );
}
