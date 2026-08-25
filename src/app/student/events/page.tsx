"use client";

import { use } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { EventOccurrences } from "@/features/events/event-card";
import { MonthCalendar } from "@/features/events/month-calendar";
import { resolveSeoulMonth, type MonthSearchValue } from "@/features/events/month-navigation";
import { resolveSeoulMonday, WeekNavigation, type WeekSearchValue } from "@/features/events/week-navigation";

type StudentEventsPageProps = {
  searchParams: Promise<{
    view?: string | string[];
    week?: WeekSearchValue;
    month?: MonthSearchValue;
  }>;
};

export default function StudentEventsPage({ searchParams }: StudentEventsPageProps) {
  const { view, week, month } = use(searchParams);
  const selectedView = view === "month" ? "month" : "week";
  const selectedWeek = resolveSeoulMonday(week);
  const selectedMonth = resolveSeoulMonth(month);

  return (
    <main className="events-shell">
      <header className="events-page-header">
        <div>
          <h1>일정</h1>
        </div>
        <nav className="event-view-switch" aria-label="일정 보기 방식">
          <Button asChild variant={selectedView === "week" ? "default" : "outline"}>
            <Link href={`/student/events?view=week&week=${selectedWeek}`} aria-current={selectedView === "week" ? "page" : undefined}>주간 보기</Link>
          </Button>
          <Button asChild variant={selectedView === "month" ? "default" : "outline"}>
            <Link href={`/student/events?view=month&month=${selectedMonth}`} aria-current={selectedView === "month" ? "page" : undefined}>월간 보기</Link>
          </Button>
        </nav>
      </header>
      {selectedView === "month" ? (
        <MonthCalendar key={selectedMonth} month={selectedMonth} />
      ) : (
        <>
          <WeekNavigation week={selectedWeek} />
          <EventOccurrences week={selectedWeek} />
        </>
      )}
    </main>
  );
}
