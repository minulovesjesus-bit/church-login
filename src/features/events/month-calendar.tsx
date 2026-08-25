"use client";

import { useMemo, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  EventCard,
  seoulDateKey,
  useEventOccurrences,
  type EventOccurrence,
} from "@/features/events/event-card";
import { calendarRangeForMonth, MonthNavigation } from "@/features/events/month-navigation";
import {
  dayOfWeek,
  formatCalendarDate,
  parseCalendarDate,
  seoulCalendarDate,
} from "@/features/events/week-navigation";

const WEEKDAYS_SHORT = ["월", "화", "수", "목", "금", "토", "일"];
const WEEKDAYS_LONG = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function dateLabel(date: string): string {
  const parsed = parseCalendarDate(date);
  if (!parsed) return date;
  return `${parsed.month}월 ${parsed.day}일 ${WEEKDAYS_LONG[dayOfWeek(parsed)]}`;
}

function initialSelectedDate(month: string): string {
  const today = formatCalendarDate(seoulCalendarDate(new Date()));
  return today.startsWith(`${month}-`) ? today : `${month}-01`;
}

function eventsByDate(events: EventOccurrence[]): Map<string, EventOccurrence[]> {
  const grouped = new Map<string, EventOccurrence[]>();
  events.forEach((event) => {
    const date = seoulDateKey(event.local_start);
    grouped.set(date, [...(grouped.get(date) ?? []), event]);
  });
  return grouped;
}

export function MonthCalendar({ month }: { month: string }) {
  const range = calendarRangeForMonth(month);
  const state = useEventOccurrences(range?.from ?? "", range?.to);
  const [selectedDate, setSelectedDate] = useState(() => initialSelectedDate(month));
  const grouped = useMemo(() => eventsByDate(state.events), [state.events]);
  const selectedEvents = grouped.get(selectedDate) ?? [];
  const [year, monthNumber] = month.split("-").map(Number);

  if (!range || !Number.isFinite(year) || !Number.isFinite(monthNumber)) return null;

  return (
    <section className="event-month-view" aria-labelledby="event-month-heading">
      <div className="event-month-header">
        <h2 id="event-month-heading">{year}년 {monthNumber}월</h2>
        <MonthNavigation month={month} />
      </div>

      {state.status === "loading" ? (
        <div className="event-loading" role="status">
          <p>월간 일정을 불러오고 있습니다.</p>
          <Skeleton className="h-96 w-full" aria-hidden="true" />
        </div>
      ) : null}
      {state.status === "auth" ? <p className="event-loading" role="status">로그인 페이지로 이동하고 있습니다.</p> : null}
      {state.status === "error" ? (
        <Alert className="event-error" variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
          <Button type="button" variant="outline" onClick={state.retry}>다시 시도</Button>
        </Alert>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div className="event-month-calendar" role="grid" aria-label={`${year}년 ${monthNumber}월 일정 달력`}>
            <div className="event-month-calendar__weekdays" role="row">
              {WEEKDAYS_SHORT.map((weekday) => <span key={weekday} role="columnheader">{weekday}</span>)}
            </div>
            {Array.from({ length: 6 }, (_, weekIndex) => (
              <div className="event-month-calendar__week" role="row" key={weekIndex}>
                {range.dates.slice(weekIndex * 7, weekIndex * 7 + 7).map((date) => {
                  const parsed = parseCalendarDate(date)!;
                  const events = grouped.get(date) ?? [];
                  const outsideMonth = date.slice(0, 7) !== month;
                  const label = `${dateLabel(date)}, 일정 ${events.length}개`;
                  return (
                    <div className="event-month-calendar__cell" role="gridcell" key={date}>
                      <button
                        type="button"
                        className="event-month-calendar__day"
                        data-outside-month={outsideMonth || undefined}
                        data-selected={selectedDate === date || undefined}
                        aria-label={label}
                        aria-pressed={selectedDate === date}
                        onClick={() => setSelectedDate(date)}
                      >
                        <span className="event-month-calendar__date">{parsed.day}</span>
                        <span className="event-month-calendar__events" aria-hidden="true">
                          {events.slice(0, 2).map((event) => <span key={event.occurrence_id}>{event.title}</span>)}
                          {events.length > 2 ? <span>+{events.length - 2}개</span> : null}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          <section className="event-month-details" role="region" aria-label={`${dateLabel(selectedDate)} 일정 상세`}>
            <h2>{dateLabel(selectedDate)}</h2>
            {selectedEvents.length ? (
              <ul className="event-list" aria-label={`${dateLabel(selectedDate)} 일정 목록`}>
                {selectedEvents.map((event) => (
                  <li className="event-list__item" key={event.occurrence_id}>
                    <EventCard event={event} />
                    <Separator />
                  </li>
                ))}
              </ul>
            ) : (
              <Empty className="event-empty"><EmptyHeader><EmptyTitle>선택한 날짜에 일정이 없습니다.</EmptyTitle></EmptyHeader></Empty>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
