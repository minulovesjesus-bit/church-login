import Link from "next/link";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  addCalendarDays,
  dayOfWeek,
  formatCalendarDate,
  parseCalendarDate,
  seoulCalendarDate,
  type CalendarDate,
} from "@/features/events/week-navigation";

export type MonthSearchValue = string | string[] | undefined;

export type MonthRange = {
  from: string;
  to: string;
  dates: string[];
};

function parseMonth(value: string): CalendarDate | undefined {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  return parseCalendarDate(`${match[1]}-${match[2]}-01`);
}

function monthValue(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`;
}

function moveMonth(date: CalendarDate, offset: -1 | 1): CalendarDate {
  if (offset === -1 && date.month === 1) return { year: date.year - 1, month: 12, day: 1 };
  if (offset === 1 && date.month === 12) return { year: date.year + 1, month: 1, day: 1 };
  return { year: date.year, month: date.month + offset, day: 1 };
}

export function calendarRangeForMonth(month: string): MonthRange | undefined {
  const first = parseMonth(month);
  if (!first) return undefined;
  const start = addCalendarDays(first, -((dayOfWeek(first) + 6) % 7));
  const end = addCalendarDays(start, 42);
  if (start.year < 1 || end.year > 9999) return undefined;
  return {
    from: formatCalendarDate(start),
    to: formatCalendarDate(end),
    dates: Array.from({ length: 42 }, (_, index) => formatCalendarDate(addCalendarDays(start, index))),
  };
}

export function currentSeoulMonth(now = new Date()): string {
  return monthValue(seoulCalendarDate(now));
}

export function resolveSeoulMonth(value: MonthSearchValue, now = new Date()): string {
  if (typeof value === "string" && calendarRangeForMonth(value)) return value;
  return currentSeoulMonth(now);
}

export function adjacentSeoulMonth(month: string, offset: -1 | 1): string | undefined {
  const current = parseMonth(month);
  if (!current) return undefined;
  const adjacent = moveMonth(current, offset);
  if (adjacent.year < 1 || adjacent.year > 9999) return undefined;
  const value = monthValue(adjacent);
  return calendarRangeForMonth(value) ? value : undefined;
}

export function MonthNavigation({ month, currentMonth = currentSeoulMonth() }: { month: string; currentMonth?: string }) {
  const previous = adjacentSeoulMonth(month, -1);
  const next = adjacentSeoulMonth(month, 1);

  return (
    <nav className="event-month-navigation" aria-label="월간 일정 탐색">
      {previous ? (
        <Button asChild variant="outline">
          <Link href={`/student/events?view=month&month=${previous}`}><ChevronLeftIcon data-icon="inline-start" />이전 달</Link>
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled><ChevronLeftIcon data-icon="inline-start" />이전 달</Button>
      )}
      <Button asChild variant="secondary">
        <Link href={`/student/events?view=month&month=${currentMonth}`}><CalendarDaysIcon data-icon="inline-start" />이번 달</Link>
      </Button>
      {next ? (
        <Button asChild variant="outline">
          <Link href={`/student/events?view=month&month=${next}`}>다음 달<ChevronRightIcon data-icon="inline-end" /></Link>
        </Button>
      ) : (
        <Button type="button" variant="outline" disabled>다음 달<ChevronRightIcon data-icon="inline-end" /></Button>
      )}
    </nav>
  );
}
